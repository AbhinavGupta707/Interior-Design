import { designOptionRecoverySchema } from "./contracts";
import type { DesignOptionRecovery } from "./contracts";

interface RecoveryStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

function recoveryKey(projectId: string): string {
  return `hds:c12:option-recovery:${projectId}`;
}

export function clearDesignOptionRecovery(storage: RecoveryStorage, projectId: string): void {
  storage.removeItem(recoveryKey(projectId));
}

export function readDesignOptionRecovery(
  storage: RecoveryStorage,
  projectId: string,
): DesignOptionRecovery | undefined {
  const raw = storage.getItem(recoveryKey(projectId));
  if (!raw || raw.length > 2_000) return undefined;
  const payload: unknown = (() => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return undefined;
    }
  })();
  const parsed = designOptionRecoverySchema.safeParse(payload);
  if (!parsed.success || parsed.data.projectId !== projectId) return undefined;
  return parsed.data;
}

export function saveDesignOptionRecovery(
  storage: RecoveryStorage,
  recovery: DesignOptionRecovery,
): void {
  const parsed = designOptionRecoverySchema.parse(recovery);
  storage.setItem(recoveryKey(parsed.projectId), JSON.stringify(parsed));
}
