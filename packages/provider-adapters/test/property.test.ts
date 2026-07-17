import { describe, expect, it } from "vitest";

import {
  DisabledPropertyAdapter,
  FixturePropertyAdapter,
  UnavailablePropertyAdapter,
  syntheticPropertyFixtureCatalog,
} from "../src/property/index.js";

const now = new Date("2026-07-17T12:00:00.000Z");
const request = (query: string) => ({ countryCode: "GB" as const, query });

describe("property adapters", () => {
  it("returns the exact accepted synthetic identity with source and permission metadata", async () => {
    const result = await new FixturePropertyAdapter({ clock: () => now }).resolve(
      request("14 Example Mews, Testford, ZZ1 1ZZ"),
    );

    expect(result.status).toBe("matched");
    expect(result.providerState).toBe("fixture");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      displayAddress: "14 Example Mews, Testford, ZZ1 1ZZ",
      identifiers: [{ scheme: "UPRN", value: "000000000014" }],
      source: {
        coverage: "fixture-complete",
        datasetVersion: "c3-fixture-v1",
        modelTrainingAllowed: false,
        providerId: "fixture-property",
        retrievedAt: now.toISOString(),
        serviceProcessingAllowed: true,
      },
    });
  });

  it("returns two alternatives with different UPRNs at one shared point", async () => {
    const result = await new FixturePropertyAdapter({ clock: () => now }).resolve(
      request("20 Shared Point Court"),
    );

    expect(result.status).toBe("ambiguous");
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((candidate) => candidate.identifiers[0]?.value)).toEqual([
      "000000000021",
      "000000000022",
    ]);
    expect(result.candidates[0]?.location).toEqual(result.candidates[1]?.location);
  });

  it("keeps a fixture no-match distinct from disabled and unavailable states", async () => {
    const noMatch = await new FixturePropertyAdapter().resolve(
      request("99 Missing Fixture Road, Testford, ZZ9 9ZZ"),
    );
    const disabled = await new DisabledPropertyAdapter().resolve(request("14 Example Mews"));
    const unavailable = await new UnavailablePropertyAdapter().resolve(request("14 Example Mews"));

    expect(noMatch).toEqual({ candidates: [], providerState: "fixture", status: "no-match" });
    expect(disabled).toEqual({
      candidates: [],
      providerState: "disabled",
      status: "unavailable",
    });
    expect(unavailable).toEqual({
      candidates: [],
      providerState: "unavailable",
      status: "unavailable",
    });
  });

  it("surfaces an injected fixture outage without falling back to catalog output", async () => {
    const result = await new FixturePropertyAdapter({ injectOutage: true }).resolve(
      request("14 Example Mews"),
    );

    expect(result).toEqual({
      candidates: [],
      providerState: "unavailable",
      status: "unavailable",
    });
  });

  it("contains only conspicuous synthetic fixture names and reserved ZZ postcodes", () => {
    const serialized = JSON.stringify(syntheticPropertyFixtureCatalog);
    expect(serialized).toContain("Example Mews");
    expect(serialized).toContain("Shared Point Court");
    expect(serialized).toMatch(/ZZ1 [12]ZZ/u);
    expect(serialized).not.toMatch(/\b(?:SW|W|E|N|SE|NW|EC|WC|M|B|LS|EH|CF)\d/u);
  });
});
