import { materialsProductsRecoverySchema } from "./contracts";
import type { MaterialsProductsRecovery } from "./contracts";

interface RecoveryStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

function recoveryKey(projectId: string): string {
  return `hds:c13:selection-recovery:${projectId}`;
}

export function clearMaterialsProductsRecovery(storage: RecoveryStorage, projectId: string): void {
  storage.removeItem(recoveryKey(projectId));
}

export function readMaterialsProductsRecovery(
  storage: RecoveryStorage,
  projectId: string,
): MaterialsProductsRecovery | undefined {
  const raw = storage.getItem(recoveryKey(projectId));
  if (!raw || raw.length > 1_000) return undefined;
  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  const parsed = materialsProductsRecoverySchema.safeParse(payload);
  return parsed.success && parsed.data.projectId === projectId ? parsed.data : undefined;
}

export function saveMaterialsProductsRecovery(
  storage: RecoveryStorage,
  recovery: MaterialsProductsRecovery,
): void {
  const parsed = materialsProductsRecoverySchema.parse(recovery);
  // Only opaque identifiers are retained for this tab. Notes, schedules, asset records,
  // rights data and previews are deliberately never persisted in browser storage.
  storage.setItem(recoveryKey(parsed.projectId), JSON.stringify(parsed));
}
