import type { FastifyInstance } from "fastify";

export interface ReadinessCheckContext {
  readonly signal: AbortSignal;
}

export interface ReadinessCheck {
  readonly check: (context: ReadinessCheckContext) => Promise<void> | void;
  readonly name: string;
  readonly required?: boolean;
}

export interface LivenessResponse {
  readonly status: "ok";
}

export interface ReadinessCheckResult {
  readonly name: string;
  readonly required: boolean;
  readonly status: "available" | "unavailable";
}

export interface ReadinessResponse {
  readonly checks: readonly ReadinessCheckResult[];
  readonly status: "ready" | "not_ready";
}

const CHECK_NAME_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;

function validateChecks(checks: readonly ReadinessCheck[]): void {
  const names = new Set<string>();
  for (const check of checks) {
    if (!CHECK_NAME_PATTERN.test(check.name)) {
      throw new TypeError(`Invalid readiness check name: ${check.name}`);
    }
    if (names.has(check.name)) {
      throw new TypeError(`Duplicate readiness check name: ${check.name}`);
    }
    names.add(check.name);
  }
}

async function evaluateCheck(
  check: ReadinessCheck,
  timeoutMs: number,
): Promise<ReadinessCheckResult> {
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("Readiness check timed out"));
    }, timeoutMs);
    timeout.unref();
  });

  try {
    await Promise.race([
      Promise.resolve().then(async () => check.check({ signal: controller.signal })),
      deadline,
    ]);
    return { name: check.name, required: check.required ?? true, status: "available" };
  } catch {
    return { name: check.name, required: check.required ?? true, status: "unavailable" };
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

export function registerHealthRoutes(
  server: FastifyInstance,
  checks: readonly ReadinessCheck[],
  timeoutMs: number,
): void {
  validateChecks(checks);

  const livenessHandler = (): LivenessResponse => ({ status: "ok" });
  server.get<{ Reply: LivenessResponse }>("/health", livenessHandler);
  server.get<{ Reply: LivenessResponse }>("/health/live", livenessHandler);

  server.get<{ Reply: ReadinessResponse }>("/health/ready", async (request, reply) => {
    void reply.header("cache-control", "no-store");
    const results = await Promise.all(checks.map(async (check) => evaluateCheck(check, timeoutMs)));
    const isReady = results.every((result) => !result.required || result.status === "available");
    const response: ReadinessResponse = {
      checks: results,
      status: isReady ? "ready" : "not_ready",
    };

    if (!isReady) {
      request.log.warn(
        {
          unavailableDependencies: results
            .filter((result) => result.status === "unavailable")
            .map((result) => result.name),
        },
        "readiness check failed",
      );
    }

    return reply.status(isReady ? 200 : 503).send(response);
  });
}
