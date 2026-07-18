import { loadPlatformApiConfig } from "../../../packages/config/src/index.ts";
import { createServer } from "../../../services/platform-api/src/app.ts";
import {
  applyC1Migration,
  bootstrapC1Fixtures,
  createC1Sql,
} from "../../../services/platform-api/src/c1.ts";
import { applyC10Migration } from "../../../services/platform-api/src/c10.ts";
import { applyC11Migration } from "../../../services/platform-api/src/c11.ts";
import { applyC2Migration } from "../../../services/platform-api/src/c2.ts";
import { applyC3Migration } from "../../../services/platform-api/src/c3.ts";
import { applyC4Migration } from "../../../services/platform-api/src/c4.ts";
import { applyC5Migration } from "../../../services/platform-api/src/c5.ts";
import { applyC6Migration } from "../../../services/platform-api/src/c6.ts";
import { applyC7Migration } from "../../../services/platform-api/src/c7.ts";
import { applyC8Migration } from "../../../services/platform-api/src/c8.ts";
import { applyC9Migration } from "../../../services/platform-api/src/c9.ts";

const databaseUrl = process.env.C11_LIVE_DATABASE_URL;
if (!databaseUrl)
  throw new Error("C11_LIVE_DATABASE_URL is required for producer-live acceptance.");

const port = Number(process.env.C11_LIVE_API_PORT ?? "4341");
const sessionSecret = "c11-live-browser-session-secret-at-least-thirty-two-bytes";
const administration = createC1Sql(databaseUrl);

await applyC1Migration(administration);
await bootstrapC1Fixtures(administration, "test");
await applyC2Migration(administration);
await applyC3Migration(administration);
await applyC4Migration(administration);
await applyC5Migration(administration);
await applyC6Migration(administration);
await applyC7Migration(administration);
await applyC8Migration(administration);
await applyC9Migration(administration);
await applyC10Migration(administration);
await applyC11Migration(administration);

const config = loadPlatformApiConfig({
  NODE_ENV: "test",
  PLATFORM_API_LOG_LEVEL: "silent",
  PLATFORM_API_PORT: String(port),
  PLATFORM_API_READINESS_TIMEOUT_MS: "5000",
  PLATFORM_API_SHUTDOWN_TIMEOUT_MS: "2000",
});
const server = createServer({
  c1: { closeDatabase: true, database: createC1Sql(databaseUrl) },
  c11: { closeDatabase: true, database: createC1Sql(databaseUrl) },
  config,
  environment: {
    C1_AUTH_MODE: "local",
    C1_LOCAL_SESSION_SECRET: sessionSecret,
    NODE_ENV: "test",
  },
  logger: false,
});

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await server.close();
  await administration.end({ timeout: 5 });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void close().finally(() => process.exit(0));
  });
}

await server.listen({ host: "127.0.0.1", port });
