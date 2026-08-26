import { designOptionRecoverySchema } from "./contracts";
import type { DesignOptionRecovery } from "./contracts";
import { z } from "zod";

interface RecoveryStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

function recoveryKey(projectId: string): string {
  return `hds:c12:option-recovery:${projectId}`;
}

const legacyRecoverySchema = z
  .object({
    leftOptionId: z.uuid().optional(),
    confirmations: z.array(z.unknown()).max(4).optional(),
    projectId: z.uuid(),
    rightOptionId: z.uuid().optional(),
    savedAt: z.iso.datetime({ offset: true }),
    schemaVersion: z.literal("c12-design-options-recovery-v1"),
    selectedJobId: z.uuid(),
  })
  .strict()
  .refine(
    ({ leftOptionId, rightOptionId }) =>
      leftOptionId === undefined || rightOptionId === undefined || leftOptionId !== rightOptionId,
  );

export function clearDesignOptionRecovery(storage: RecoveryStorage, projectId: string): void {
  storage.removeItem(recoveryKey(projectId));
}

export function readDesignOptionRecovery(
  storage: RecoveryStorage,
  projectId: string,
): DesignOptionRecovery | undefined {
  const raw = storage.getItem(recoveryKey(projectId));
  if (!raw || raw.length > 8_000) return undefined;
  const payload: unknown = (() => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return undefined;
    }
  })();
  const parsed = designOptionRecoverySchema.safeParse(payload);
  if (parsed.success && parsed.data.projectId === projectId) return parsed.data;
  const legacy = legacyRecoverySchema.safeParse(payload);
  if (!legacy.success || legacy.data.projectId !== projectId) return undefined;
  const migrated = designOptionRecoverySchema.parse({
    ...(legacy.data.leftOptionId ? { leftOptionId: legacy.data.leftOptionId } : {}),
    projectId,
    ...(legacy.data.rightOptionId ? { rightOptionId: legacy.data.rightOptionId } : {}),
    savedAt: legacy.data.savedAt,
    schemaVersion: "c12-design-options-recovery-v2",
    selectedJobId: legacy.data.selectedJobId,
  });
  storage.setItem(recoveryKey(projectId), JSON.stringify(migrated));
  return migrated;
}

export function saveDesignOptionRecovery(
  storage: RecoveryStorage,
  recovery: DesignOptionRecovery,
): void {
  const parsed = designOptionRecoverySchema.parse(recovery);
  storage.setItem(recoveryKey(parsed.projectId), JSON.stringify(parsed));
}
