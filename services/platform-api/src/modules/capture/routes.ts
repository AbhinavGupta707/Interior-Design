import { authoriseProjectAction, type ProjectAction } from "@interior-design/authz";
import {
  c7RouteContract,
  captureArtifactAccessResponseSchema,
  captureArtifactUploadSessionSchema,
  captureEnvelopeReconstructionSchema,
  captureEnvelopeRecordSchema,
  captureEnvelopeRouteContract,
  capturePackageSchema,
  captureProposalResultSchema,
  captureSessionIdSchema,
  captureSessionSchema,
  completeCaptureArtifactUploadRequestSchema,
  createCaptureEnvelopeRequestSchema,
  createCaptureArtifactUploadRequestSchema,
  createCapturePackageRequestSchema,
  createCaptureSessionRequestSchema,
  projectIdSchema,
  signCaptureArtifactPartRequestSchema,
  signedCaptureArtifactPartSchema,
  startCaptureEnvelopeReconstructionRequestSchema,
  type Actor,
} from "@interior-design/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { getRequestCorrelation } from "../../correlation.js";
import { forbidden, notFound, parseRequest } from "../identity/http.js";
import type { IdentityService } from "../identity/service.js";
import { parseIdempotencyKey, requestHash } from "../projects/idempotency.js";
import type { ProjectRepository } from "../projects/repository.js";
import type { ReconstructionService } from "../reconstruction/service.js";
import { captureConflict } from "./errors.js";
import type { CaptureBackend } from "./types.js";

const projectParamsSchema = z.object({ projectId: projectIdSchema }).strict();
const sessionParamsSchema = z
  .object({ captureSessionId: captureSessionIdSchema, projectId: projectIdSchema })
  .strict();
const uploadParamsSchema = sessionParamsSchema.extend({ uploadSessionId: z.uuid() }).strict();
const artifactParamsSchema = sessionParamsSchema.extend({ artifactId: z.uuid() }).strict();
const packageParamsSchema = sessionParamsSchema.extend({ packageId: z.uuid() }).strict();
const emptyMutationSchema = z.union([z.undefined(), z.object({}).strict()]);

async function authorisedProject(
  request: FastifyRequest,
  projectId: string,
  action: ProjectAction,
  identity: IdentityService,
  projects: ProjectRepository,
): Promise<Actor> {
  const session = await identity.authenticate(request.headers.authorization);
  if (
    !authoriseProjectAction(session.actor, action, { tenantId: session.actor.tenantId }).allowed
  ) {
    throw forbidden();
  }
  if ((await projects.findById(session.actor.tenantId, projectId)) === undefined) throw notFound();
  return session.actor;
}

function replayHeader(
  reply: { header(name: string, value: string): unknown },
  replayed: boolean,
): void {
  if (replayed) reply.header("Idempotent-Replay", "true");
}

export function registerCaptureRoutes(
  server: FastifyInstance,
  identity: IdentityService,
  projects: ProjectRepository,
  backend: CaptureBackend,
  reconstruction?: ReconstructionService,
): void {
  server.post(c7RouteContract.createSession, async (request, reply) => {
    const params = parseRequest(projectParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "capture:session:create",
      identity,
      projects,
    );
    const body = parseRequest(createCaptureSessionRequestSchema, request.body);
    const result = await backend.createSession({
      actor,
      correlation: getRequestCorrelation(request),
      idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
      projectId: params.projectId,
      request: body,
    });
    replayHeader(reply, result.replayed);
    return reply.status(201).send(captureSessionSchema.parse(result.value));
  });

  server.get(c7RouteContract.listSessions, async (request, reply) => {
    const params = parseRequest(projectParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "capture:session:read",
      identity,
      projects,
    );
    return reply.send(
      z
        .array(captureSessionSchema)
        .max(10_000)
        .parse(await backend.listSessions(actor.tenantId, params.projectId)),
    );
  });

  server.get(c7RouteContract.getSession, async (request, reply) => {
    const params = parseRequest(sessionParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "capture:session:read",
      identity,
      projects,
    );
    const capture = await backend.findSession(
      actor.tenantId,
      params.projectId,
      params.captureSessionId,
    );
    if (capture === undefined) throw notFound();
    return reply.send(captureSessionSchema.parse(capture));
  });

  for (const transition of ["cancel", "retry"] as const) {
    const route =
      transition === "cancel" ? c7RouteContract.cancelSession : c7RouteContract.retrySession;
    const action = transition === "cancel" ? "capture:session:cancel" : "capture:proposal:retry";
    server.post(route, async (request, reply) => {
      const params = parseRequest(sessionParamsSchema, request.params);
      const actor = await authorisedProject(request, params.projectId, action, identity, projects);
      parseRequest(emptyMutationSchema, request.body);
      const command = {
        actor,
        captureSessionId: params.captureSessionId,
        correlation: getRequestCorrelation(request),
        idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
        projectId: params.projectId,
      };
      const result =
        transition === "cancel"
          ? await backend.cancelSession(command)
          : await backend.retrySession(command);
      replayHeader(reply, result.replayed);
      return reply.send(captureSessionSchema.parse(result.value));
    });
  }

  server.post(c7RouteContract.createArtifactUpload, async (request, reply) => {
    const params = parseRequest(sessionParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "capture:artifact:upload",
      identity,
      projects,
    );
    const result = await backend.createArtifactUpload({
      actor,
      captureSessionId: params.captureSessionId,
      correlation: getRequestCorrelation(request),
      idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
      projectId: params.projectId,
      request: parseRequest(createCaptureArtifactUploadRequestSchema, request.body),
    });
    replayHeader(reply, result.replayed);
    return reply.status(201).send(captureArtifactUploadSessionSchema.parse(result.value));
  });

  server.get(c7RouteContract.getArtifactUpload, async (request, reply) => {
    const params = parseRequest(uploadParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "capture:artifact:upload",
      identity,
      projects,
    );
    const upload = await backend.findArtifactUpload(
      actor.tenantId,
      params.projectId,
      params.captureSessionId,
      params.uploadSessionId,
    );
    if (upload === undefined) throw notFound();
    return reply.send(captureArtifactUploadSessionSchema.parse(upload));
  });

  server.post(c7RouteContract.signArtifactPart, async (request, reply) => {
    const params = parseRequest(uploadParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "capture:artifact:upload",
      identity,
      projects,
    );
    const result = await backend.signArtifactPart({
      actor,
      captureSessionId: params.captureSessionId,
      correlation: getRequestCorrelation(request),
      idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
      projectId: params.projectId,
      request: parseRequest(signCaptureArtifactPartRequestSchema, request.body),
      uploadSessionId: params.uploadSessionId,
    });
    replayHeader(reply, result.replayed);
    return reply.send(signedCaptureArtifactPartSchema.parse(result.value));
  });

  server.post(c7RouteContract.completeArtifactUpload, async (request, reply) => {
    const params = parseRequest(uploadParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "capture:artifact:upload",
      identity,
      projects,
    );
    const result = await backend.completeArtifactUpload({
      actor,
      captureSessionId: params.captureSessionId,
      correlation: getRequestCorrelation(request),
      idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
      projectId: params.projectId,
      request: parseRequest(completeCaptureArtifactUploadRequestSchema, request.body),
      uploadSessionId: params.uploadSessionId,
    });
    replayHeader(reply, result.replayed);
    return reply.send(captureArtifactUploadSessionSchema.parse(result.value));
  });

  server.post(c7RouteContract.finalizePackage, async (request, reply) => {
    const params = parseRequest(sessionParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "capture:package:finalize",
      identity,
      projects,
    );
    const result = await backend.finalizePackage({
      actor,
      captureSessionId: params.captureSessionId,
      correlation: getRequestCorrelation(request),
      idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
      projectId: params.projectId,
      request: parseRequest(createCapturePackageRequestSchema, request.body),
    });
    replayHeader(reply, result.replayed);
    return reply.status(201).send(capturePackageSchema.parse(result.value));
  });

  server.get(c7RouteContract.getPackage, async (request, reply) => {
    const params = parseRequest(packageParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "capture:session:read",
      identity,
      projects,
    );
    const capturePackage = await backend.findPackage(
      actor.tenantId,
      params.projectId,
      params.captureSessionId,
      params.packageId,
    );
    if (capturePackage === undefined) throw notFound();
    return reply.send(capturePackageSchema.parse(capturePackage));
  });

  server.post(c7RouteContract.accessArtifact, async (request, reply) => {
    const params = parseRequest(artifactParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "capture:artifact:export",
      identity,
      projects,
    );
    parseRequest(emptyMutationSchema, request.body);
    return reply.send(
      captureArtifactAccessResponseSchema.parse(
        await backend.accessArtifact({
          actor,
          artifactId: params.artifactId,
          captureSessionId: params.captureSessionId,
          correlation: getRequestCorrelation(request),
          projectId: params.projectId,
        }),
      ),
    );
  });

  server.post(captureEnvelopeRouteContract.accept, async (request, reply) => {
    const params = parseRequest(sessionParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "capture:package:finalize",
      identity,
      projects,
    );
    const result = await backend.acceptEnvelope({
      actor,
      captureSessionId: params.captureSessionId,
      correlation: getRequestCorrelation(request),
      idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
      projectId: params.projectId,
      request: parseRequest(createCaptureEnvelopeRequestSchema, request.body),
    });
    replayHeader(reply, result.replayed);
    return reply.status(201).send(captureEnvelopeRecordSchema.parse(result.value));
  });

  server.get(captureEnvelopeRouteContract.get, async (request, reply) => {
    const params = parseRequest(sessionParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "capture:session:read",
      identity,
      projects,
    );
    const record = await backend.findEnvelope(
      actor.tenantId,
      params.projectId,
      params.captureSessionId,
    );
    if (record === undefined) throw notFound();
    return reply.send(captureEnvelopeRecordSchema.parse(record));
  });

  server.post(captureEnvelopeRouteContract.startReconstruction, async (request, reply) => {
    if (reconstruction === undefined) {
      throw captureConflict(
        "CAPTURE_RECONSTRUCTION_UNAVAILABLE",
        "The authenticated reconstruction service is not available.",
      );
    }
    const params = parseRequest(sessionParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "reconstruction:job:create",
      identity,
      projects,
    );
    const body = parseRequest(startCaptureEnvelopeReconstructionRequestSchema, request.body);
    parseIdempotencyKey(request.headers["idempotency-key"]);
    const record = await backend.findEnvelope(
      actor.tenantId,
      params.projectId,
      params.captureSessionId,
    );
    if (record === undefined) throw notFound();
    if (record.acceptance.envelopeSha256 !== body.expectedEnvelopeSha256) {
      throw captureConflict(
        "CAPTURE_ENVELOPE_CHANGED",
        "The accepted envelope hash does not match the reconstruction request.",
      );
    }
    const existingJobId = await backend.findEnvelopeReconstructionJobId(
      actor.tenantId,
      params.projectId,
      params.captureSessionId,
    );
    const reconstructionRequest = {
      appearanceMode: body.appearanceMode,
      label: `Guided capture ${params.captureSessionId.slice(0, 8)}`,
      mode: "rgb-sfm" as const,
      registrationAnchors: [],
      rights: record.envelope.rights,
      sources: record.envelope.mediaSources.map((source) => ({
        assetId: source.assetId,
        byteSize: source.byteSize,
        detectedMimeType: source.mimeType,
        kind: source.kind === "rgb-video" ? ("rgb-video" as const) : ("rgb-image" as const),
        sha256: source.sha256,
      })),
    };
    const result =
      existingJobId === undefined
        ? await reconstruction.createJob({
            actor,
            correlation: getRequestCorrelation(request),
            idempotencyKey: record.acceptance.envelopeId,
            projectId: params.projectId,
            request: reconstructionRequest,
          })
        : await (async () => {
            const job = await reconstruction.getJob(
              actor.tenantId,
              params.projectId,
              existingJobId,
            );
            if (requestHash(job.request) !== requestHash(reconstructionRequest)) {
              throw captureConflict(
                "CAPTURE_RECONSTRUCTION_CHANGED",
                "The accepted envelope already has reconstruction work with a different request.",
              );
            }
            return { job, replayed: true };
          })();
    if (existingJobId === undefined) {
      await backend.linkEnvelopeReconstruction({
        actorUserId: actor.userId,
        captureSessionId: params.captureSessionId,
        envelopeId: record.acceptance.envelopeId,
        projectId: params.projectId,
        reconstructionJobId: result.job.id,
        tenantId: actor.tenantId,
      });
    }
    replayHeader(reply, result.replayed);
    return reply.status(result.replayed ? 200 : 201).send(
      captureEnvelopeReconstructionSchema.parse({
        captureSessionId: params.captureSessionId,
        envelopeId: record.acceptance.envelopeId,
        envelopeSha256: record.acceptance.envelopeSha256,
        projectId: params.projectId,
        reconstructionJob: result.job,
        schemaVersion: "capture-envelope-reconstruction-v1",
      }),
    );
  });

  server.get(c7RouteContract.getProposal, async (request, reply) => {
    const params = parseRequest(sessionParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "capture:proposal:read",
      identity,
      projects,
    );
    const result = await backend.findProposal(
      actor.tenantId,
      params.projectId,
      params.captureSessionId,
    );
    if (result === undefined) throw notFound();
    return reply.send(captureProposalResultSchema.parse(result));
  });
}
