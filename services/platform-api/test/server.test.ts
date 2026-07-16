import { afterEach, describe, expect, it } from "vitest";

import { createServer } from "../src/server.js";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

describe("platform API bootstrap", () => {
  it("reports a local health result", async () => {
    const server = createServer();
    servers.push(server);

    const response = await server.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});
