import Fastify, { type FastifyInstance } from "fastify";
import { pathToFileURL } from "node:url";

export function createServer(): FastifyInstance {
  const server = Fastify({ logger: false });

  server.get("/health", () => ({ status: "ok" as const }));

  return server;
}

async function start(): Promise<void> {
  const server = createServer();
  await server.listen({ host: "127.0.0.1", port: 4100 });
}

const entrypoint = process.argv[1];

if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  void start();
}
