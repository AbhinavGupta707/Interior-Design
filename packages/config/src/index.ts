import { z } from "zod";

export const runtimeEnvironmentSchema = z.enum(["development", "test", "production"]);

export type RuntimeEnvironment = z.infer<typeof runtimeEnvironmentSchema>;
