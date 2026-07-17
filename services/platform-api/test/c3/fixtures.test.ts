import { readFile } from "node:fs/promises";
import path from "node:path";

import { syntheticPropertyFixtureCatalog } from "@interior-design/provider-adapters/property";
import { describe, expect, it } from "vitest";

describe("C3 synthetic fixture safety", () => {
  it("keeps the external manifest aligned and scans every address as conspicuously synthetic", async () => {
    const fixturePath = path.resolve(
      process.cwd(),
      "../../tests/fixtures/c3/property/catalog.json",
    );
    const text = await readFile(fixturePath, "utf8");
    const manifest = JSON.parse(text) as {
      readonly acceptedIdentity: { readonly displayAddress: string; readonly uprn: string };
      readonly ambiguousSharedPoint: readonly {
        readonly displayAddress: string;
        readonly location: unknown;
        readonly uprn: string;
      }[];
    };

    expect(manifest.acceptedIdentity).toEqual({
      displayAddress: syntheticPropertyFixtureCatalog[0]?.displayAddress,
      uprn: syntheticPropertyFixtureCatalog[0]?.uprn,
    });
    expect(
      manifest.ambiguousSharedPoint.map(({ displayAddress, uprn }) => ({ displayAddress, uprn })),
    ).toEqual(
      syntheticPropertyFixtureCatalog.slice(1).map((entry) => ({
        displayAddress: entry.displayAddress,
        uprn: entry.uprn,
      })),
    );
    const serializedAddresses = [
      manifest.acceptedIdentity.displayAddress,
      ...manifest.ambiguousSharedPoint.map((candidate) => candidate.displayAddress),
    ].join("\n");
    expect(serializedAddresses).toMatch(/Example Mews/u);
    expect(serializedAddresses).toMatch(/Shared Point Court/u);
    const postcodes = serializedAddresses.match(/\b[A-Z]{2}\d\s\d[A-Z]{2}\b/gu) ?? [];
    expect(postcodes).toHaveLength(3);
    expect(postcodes.every((postcode) => postcode.startsWith("ZZ"))).toBe(true);
  });

  it("keeps address-query fields in the API redaction policy and property code free of ad-hoc logs", async () => {
    const appSource = await readFile(path.resolve(process.cwd(), "src/app.ts"), "utf8");
    expect(appSource).toContain('"req.headers.authorization"');
    expect(appSource).toContain('"req.body.query"');
    expect(appSource).toContain('"req.body.address"');
    expect(appSource).toContain('"request.body.displayAddress"');

    const propertySources = await Promise.all(
      ["routes.ts", "postgres.ts", "dossier.ts"].map((fileName) =>
        readFile(path.resolve(process.cwd(), "src/modules/property", fileName), "utf8"),
      ),
    );
    const combined = propertySources.join("\n");
    expect(combined).not.toMatch(/console\.|request\.log|\.log\.(?:info|warn|error)/u);
    expect(combined).not.toMatch(/rawProvider|providerPayload|provider_payload/u);
  });
});
