import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(process.cwd(), "ml/reconstruction/windows-nvidia");

describe("C8 Windows/NVIDIA evidence package", () => {
  it("pins the required host, CUDA, Python, tool and source identities", async () => {
    const versions = JSON.parse(
      await readFile(path.join(packageRoot, "versions.json"), "utf8"),
    ) as {
      container: Record<string, string>;
      host: Record<string, string>;
      runtime: Record<string, unknown>;
      verificationState: string;
    };
    expect(versions.host.operatingSystem).toBe("Windows 11 24H2");
    expect(versions.host.nvidiaWindowsDriver).toBe("572.83");
    expect(versions.container.cudaBaseImage).toMatch(/@sha256:[a-f0-9]{64}$/u);
    expect(versions.container.pythonBaseImage).toMatch(/@sha256:[a-f0-9]{64}$/u);
    expect(versions.runtime).toMatchObject({
      cuda: "11.8.0",
      numpy: "1.26.4",
      python: "3.10.13",
      pytorch: "2.1.2+cu118",
      torchvision: "0.16.2+cu118",
    });
    expect(versions.verificationState).toBe("NOT_RUN");
  });

  it("keeps the evidence template NOT RUN and the Python lock hash-complete", async () => {
    const evidence = JSON.parse(
      await readFile(path.join(packageRoot, "evidence-template.json"), "utf8"),
    ) as { status: string; dataset: { trainingUseConsent: string } };
    const lock = await readFile(path.join(packageRoot, "requirements.lock"), "utf8");
    expect(evidence.status).toBe("NOT_RUN");
    expect(evidence.dataset.trainingUseConsent).toBe("denied");
    for (const pinned of [
      "torch==2.1.2+cu118",
      "torchvision==0.16.2+cu118",
      "nerfstudio==1.1.5",
      "gsplat==1.4.0",
      "numpy==1.26.4",
    ]) {
      expect(lock).toContain(pinned);
    }
    expect(lock.match(/--hash=sha256:/gu)?.length ?? 0).toBeGreaterThan(200);
  });

  it("hash-attests every build and execution input", async () => {
    const manifest = JSON.parse(
      await readFile(path.join(packageRoot, "package-manifest.json"), "utf8"),
    ) as {
      evidenceLabel: string;
      files: Readonly<Record<string, string>>;
      hashAlgorithm: string;
    };
    expect(manifest.evidenceLabel).toBe("NOT_RUN");
    expect(manifest.hashAlgorithm).toBe("sha256");
    expect(Object.keys(manifest.files)).toHaveLength(7);
    for (const [name, expected] of Object.entries(manifest.files)) {
      const bytes = await readFile(path.join(packageRoot, name));
      expect(createHash("sha256").update(bytes).digest("hex"), name).toBe(expected);
    }
  });
});
