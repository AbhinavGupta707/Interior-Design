import { consultationRecoverySchema } from "./contracts";
import type { ConsultationRecovery } from "./contracts";

export interface RecoveryStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

function recoveryKey(projectId: string): string {
  return `hds:c11:consultation-recovery:v1:${projectId}`;
}

export function readConsultationRecovery(
  storage: RecoveryStorage,
  projectId: string,
): ConsultationRecovery | undefined {
  const key = recoveryKey(projectId);
  const raw = storage.getItem(key);
  if (raw === null) return undefined;
  const payload: unknown = (() => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return undefined;
    }
  })();
  const parsed = consultationRecoverySchema.safeParse(payload);
  if (!parsed.success || parsed.data.projectId !== projectId) {
    storage.removeItem(key);
    return undefined;
  }
  return parsed.data;
}

export function saveConsultationRecovery(
  storage: RecoveryStorage,
  recovery: ConsultationRecovery,
): void {
  const parsed = consultationRecoverySchema.parse(recovery);
  storage.setItem(recoveryKey(parsed.projectId), JSON.stringify(parsed));
}

export function clearConsultationRecovery(storage: RecoveryStorage, projectId: string): void {
  storage.removeItem(recoveryKey(projectId));
}
