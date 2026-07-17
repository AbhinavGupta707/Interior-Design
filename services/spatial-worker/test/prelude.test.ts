import { describe, expect, it } from "vitest";

import { spatialWorkerCheckpoint } from "../src/index.js";

describe("spatial worker prelude", () => {
  it("is registered as the C2 workspace service", () => {
    expect(spatialWorkerCheckpoint).toBe("C2");
  });
});
