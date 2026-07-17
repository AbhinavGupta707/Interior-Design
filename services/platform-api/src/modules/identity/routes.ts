import {
  c1RouteContract,
  localSessionRequestSchema,
  type LocalSessionResponse,
  type Session,
} from "@interior-design/contracts";
import type { FastifyInstance } from "fastify";

import { parseRequest } from "./http.js";
import type { IdentityService } from "./service.js";

export function registerIdentityRoutes(server: FastifyInstance, identity: IdentityService): void {
  server.post<{ Reply: LocalSessionResponse }>(
    c1RouteContract.createLocalSession,
    async (request, reply) => {
      const body = parseRequest(localSessionRequestSchema, request.body);
      return reply.status(201).send(await identity.createLocalSession(body.persona));
    },
  );

  server.get<{ Reply: Session }>(c1RouteContract.getSession, async (request, reply) => {
    const session = await identity.authenticate(request.headers.authorization);
    return reply.send(session);
  });
}
