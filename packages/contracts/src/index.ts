import { z } from "zod";

export const projectIdSchema = z.uuid();
export const tenantIdSchema = z.uuid();
export const userIdSchema = z.uuid();

export const memberRoleSchema = z.enum(["owner", "editor", "viewer"]);
export type MemberRole = z.infer<typeof memberRoleSchema>;

export const localPersonaSchema = z.enum(["homeowner-alpha", "homeowner-beta", "viewer-alpha"]);
export type LocalPersona = z.infer<typeof localPersonaSchema>;

export const actorSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  role: memberRoleSchema,
  subject: z.string().trim().min(3).max(200),
  tenantId: tenantIdSchema,
  userId: userIdSchema,
});
export type Actor = z.infer<typeof actorSchema>;

export const sessionSchema = z.object({
  actor: actorSchema,
  authMode: z.enum(["local-fixture", "oidc"]),
  expiresAt: z.iso.datetime({ offset: true }),
});
export type Session = z.infer<typeof sessionSchema>;

export const localSessionRequestSchema = z.object({ persona: localPersonaSchema }).strict();
export type LocalSessionRequest = z.infer<typeof localSessionRequestSchema>;

export const localSessionResponseSchema = z.object({
  accessToken: z.string().min(32),
  session: sessionSchema,
});
export type LocalSessionResponse = z.infer<typeof localSessionResponseSchema>;

export const projectStatusSchema = z.enum(["draft", "active", "archived"]);

export const projectSchema = z.object({
  createdAt: z.iso.datetime({ offset: true }),
  id: projectIdSchema,
  name: z.string().trim().min(1).max(120),
  status: projectStatusSchema,
  tenantId: tenantIdSchema,
  updatedAt: z.iso.datetime({ offset: true }),
  version: z.int().min(1),
});
export type Project = z.infer<typeof projectSchema>;

export const createProjectRequestSchema = z
  .object({ name: z.string().trim().min(1).max(120) })
  .strict();
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const dwellingTypeSchema = z.enum([
  "flat",
  "terraced-house",
  "semi-detached-house",
  "detached-house",
  "bungalow",
  "other",
]);

const boundedTextListSchema = z.array(z.string().trim().min(1).max(120)).max(12);

export const homeIntakeSchema = z
  .object({
    accessibilityNeeds: boundedTextListSchema,
    addressSummary: z.string().trim().min(1).max(160).optional(),
    bathrooms: z.int().min(0).max(20).optional(),
    bedrooms: z.int().min(0).max(30).optional(),
    dwellingType: dwellingTypeSchema,
    evidenceAvailable: z.object({
      photographs: z.boolean(),
      plans: z.boolean(),
      roomCapture: z.boolean(),
      video: z.boolean(),
    }),
    goals: boundedTextListSchema.min(1),
    household: z.object({
      adults: z.int().min(0).max(30),
      children: z.int().min(0).max(30),
      pets: z.int().min(0).max(30),
    }),
    levels: z.int().min(1).max(10).optional(),
    mustChange: boundedTextListSchema,
    mustKeep: boundedTextListSchema,
    notes: z.string().trim().max(2_000).optional(),
    styleWords: boundedTextListSchema,
  })
  .strict();
export type HomeIntake = z.infer<typeof homeIntakeSchema>;

export const projectIntakeSchema = z.object({
  intake: homeIntakeSchema,
  projectId: projectIdSchema,
  updatedAt: z.iso.datetime({ offset: true }),
  updatedBy: userIdSchema,
  version: z.int().min(1),
});
export type ProjectIntake = z.infer<typeof projectIntakeSchema>;

export const upsertProjectIntakeRequestSchema = z
  .object({
    expectedVersion: z.int().min(0),
    intake: homeIntakeSchema,
  })
  .strict();
export type UpsertProjectIntakeRequest = z.infer<typeof upsertProjectIntakeRequestSchema>;

export const c1RouteContract = Object.freeze({
  createLocalSession: "/v1/auth/local/session",
  createProject: "/v1/projects",
  getProject: "/v1/projects/:projectId",
  getProjectIntake: "/v1/projects/:projectId/intake",
  getSession: "/v1/session",
  listProjects: "/v1/projects",
  upsertProjectIntake: "/v1/projects/:projectId/intake",
});
