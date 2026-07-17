import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { PlanNormalizer, type PlanProcessPort } from "../../src/plan-processing/normalizer.js";
import type { PlanNormalizationError } from "../../src/plan-processing/types.js";
import { ProcessExecutionError } from "../../src/subprocess.js";

const directories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "c6-normalizer-test-"));
  directories.push(directory);
  return directory;
}

async function requestFor(
  sourcePath: string,
  workspaceDirectory: string,
  detectedMimeType: "application/pdf" | "image/jpeg" | "image/png" | "image/svg+xml",
  parserPreference: "auto" | "fixture" | "raster" | "vector" = "auto",
) {
  const bytes = await readFile(sourcePath);
  return {
    detectedMimeType,
    expectedByteSize: bytes.byteLength,
    expectedSha256: createHash("sha256").update(bytes).digest("hex"),
    pageIndex: 0,
    parserPreference,
    sourcePath,
    workspaceDirectory,
  } as const;
}

const tools = {
  pdfInfo: "pdfinfo",
  pdfToCairo: "pdftocairo",
  pdfToPpm: "pdftoppm",
  popplerVersion: "test-poppler-1",
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("C6 isolated plan normalization", () => {
  it("creates a deterministic vector-first manifest without retaining label text", async () => {
    const root = await temporaryDirectory();
    const sourcePath = path.join(root, "source.svg");
    const svg = `<svg viewBox="0 0 100 80"><line x1="0" y1="0" x2="100" y2="0"/><rect x="5" y="5" width="90" height="70"/><text x="10" y="10">Private room label</text></svg>`;
    await writeFile(sourcePath, svg, { mode: 0o600 });
    const leftWorkspace = await temporaryDirectory();
    const rightWorkspace = await temporaryDirectory();
    const normalizer = new PlanNormalizer(tools);
    const left = await normalizer.normalize(
      await requestFor(sourcePath, leftWorkspace, "image/svg+xml"),
    );
    const right = await normalizer.normalize(
      await requestFor(sourcePath, rightWorkspace, "image/svg+xml"),
    );
    expect(left).toMatchObject({
      coordinateSpace: "svg-microunits",
      heightSourceUnits: 80_000_000,
      mode: "deterministic-vector",
      widthSourceUnits: 100_000_000,
    });
    expect(right.sha256).toBe(left.sha256);
    const manifest = await readFile(left.filePath, "utf8");
    expect(manifest).not.toContain("Private room label");
    expect(manifest).toContain(createHash("sha256").update("Private room label").digest("hex"));
  });

  it.each([
    `<svg width="10" height="10"><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><text>&x;</text></svg>`,
    `<svg width="10" height="10"><script>alert(1)</script><line x1="0" y1="0" x2="1" y2="1"/></svg>`,
    `<svg width="10" height="10"><image href="https://example.test/private.png"/></svg>`,
    `<svg width="10" height="10"><line onload="alert(1)" x1="0" y1="0" x2="1" y2="1"/></svg>`,
  ])("rejects unsafe SVG constructs before parser invocation", async (svg) => {
    const root = await temporaryDirectory();
    const sourcePath = path.join(root, "unsafe.svg");
    await writeFile(sourcePath, svg, { mode: 0o600 });
    await expect(
      new PlanNormalizer(tools).normalize(
        await requestFor(sourcePath, await temporaryDirectory(), "image/svg+xml"),
      ),
    ).rejects.toMatchObject({ code: "unsafe-content" } satisfies Partial<PlanNormalizationError>);
  });

  it("rewrites raster input to metadata-free grayscale PNG with a stable fingerprint", async () => {
    const root = await temporaryDirectory();
    const sourcePath = path.join(root, "source.jpg");
    await sharp({
      create: { background: { b: 30, g: 20, r: 10 }, channels: 3, height: 8, width: 10 },
    })
      .withMetadata({ orientation: 1 })
      .jpeg()
      .toFile(sourcePath);
    const result = await new PlanNormalizer(tools).normalize(
      await requestFor(sourcePath, await temporaryDirectory(), "image/jpeg"),
    );
    const metadata = await sharp(result.filePath).metadata();
    expect(result).toMatchObject({
      coordinateSpace: "pixels",
      heightSourceUnits: 8,
      mode: "deterministic-raster",
      widthSourceUnits: 10,
    });
    expect(metadata.channels).toBe(1);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
  });

  it("selects PDF vector extraction before raster fallback and enforces the page ceiling", async () => {
    const root = await temporaryDirectory();
    const sourcePath = path.join(root, "source.pdf");
    await writeFile(sourcePath, "%PDF-1.7 synthetic fixture", { mode: 0o600 });
    const calls: string[] = [];
    const processPort: PlanProcessPort = {
      async run(executable, arguments_) {
        calls.push(executable);
        if (executable === "pdfinfo") return { exitCode: 0, stderr: "", stdout: "Pages: 1\n" };
        const target = arguments_.at(-1);
        if (target === undefined) throw new Error("Missing vector target.");
        await writeFile(
          target,
          `<svg viewBox="0 0 100 100"><line x1="0" y1="0" x2="100" y2="100"/></svg>`,
          { mode: 0o600 },
        );
        return { exitCode: 0, stderr: "", stdout: "" };
      },
    };
    const result = await new PlanNormalizer(tools, processPort).normalize(
      await requestFor(sourcePath, await temporaryDirectory(), "application/pdf"),
    );
    expect(result.mode).toBe("deterministic-vector");
    expect(result.normalizers.map(({ name }) => name)).toEqual([
      "poppler-pdftocairo",
      "c6-svg-vector-manifest",
    ]);
    expect(calls).toEqual(["pdfinfo", "pdftocairo"]);

    const tooManyPages: PlanProcessPort = {
      run: () => Promise.resolve({ exitCode: 0, stderr: "", stdout: "Pages: 21\n" }),
    };
    await expect(
      new PlanNormalizer(tools, tooManyPages).normalize(
        await requestFor(sourcePath, await temporaryDirectory(), "application/pdf"),
      ),
    ).rejects.toMatchObject({ code: "resource-limit" });
  });

  it("falls back from a non-vector PDF page to a bounded grayscale raster", async () => {
    const root = await temporaryDirectory();
    const sourcePath = path.join(root, "raster-source.pdf");
    await writeFile(sourcePath, "%PDF-1.7 raster fixture", { mode: 0o600 });
    const calls: string[] = [];
    const processPort: PlanProcessPort = {
      async run(executable, arguments_) {
        calls.push(executable);
        if (executable === "pdfinfo") {
          return { exitCode: 0, stderr: "", stdout: "Pages: 1\nPage size: 612 x 792 pts\n" };
        }
        if (executable === "pdftocairo") throw new ProcessExecutionError("exit", { exitCode: 1 });
        const prefix = arguments_.at(-1);
        if (prefix === undefined) throw new Error("Missing raster prefix.");
        await sharp({
          create: { background: { b: 255, g: 255, r: 255 }, channels: 3, height: 100, width: 100 },
        })
          .png()
          .toFile(`${prefix}.png`);
        return { exitCode: 0, stderr: "", stdout: "" };
      },
    };
    const result = await new PlanNormalizer(tools, processPort).normalize(
      await requestFor(sourcePath, await temporaryDirectory(), "application/pdf"),
    );
    expect(result.mode).toBe("deterministic-raster");
    expect(result.normalizers.map(({ name }) => name)).toEqual([
      "poppler-pdftoppm",
      "sharp-grayscale-png",
    ]);
    expect(calls).toEqual(["pdfinfo", "pdftocairo", "pdftoppm"]);
  });
});
