import { expect, it } from "vitest";

const liveSecurityUrl = process.env.C6_LIVE_SECURITY_URL;

it.skipIf(liveSecurityUrl === undefined)(
  "[producer-live opt-in] probes live C6 unauthenticated disclosure; SKIP when C6_LIVE_SECURITY_URL is unset",
  async () => {
    if (liveSecurityUrl === undefined) throw new Error("unreachable");
    const response = await fetch(
      `${liveSecurityUrl.replace(/\/$/u, "")}/v1/projects/foreign/plan-processing-jobs`,
    );
    expect([401, 404]).toContain(response.status);
    const text = await response.text();
    expect(text).not.toMatch(/objectKey|signedUrl|stderr|source bytes|token/iu);
  },
);
