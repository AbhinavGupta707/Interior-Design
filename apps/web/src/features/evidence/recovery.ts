import type { AssetKind, CompleteAssetUploadRequest } from "@interior-design/contracts";
import { z } from "zod";

const completedPartSchema = z.object({
  checksumSha256: z.string(),
  etag: z.string(),
  partNumber: z.number().int().positive(),
});

const recoveryRecordSchema = z.object({
  assetId: z.uuid(),
  completedParts: z.array(completedPartSchema),
  completionKey: z.string(),
  fileName: z.string(),
  kind: z.enum(["plan", "photograph", "video", "document"]),
  partSize: z.number().int().positive(),
  projectId: z.uuid(),
  sessionId: z.uuid(),
  sha256: z.string().length(64),
  updatedAt: z.string(),
});

export interface RecoveryRecord {
  assetId: string;
  completedParts: CompleteAssetUploadRequest["parts"];
  completionKey: string;
  fileName: string;
  kind: AssetKind;
  partSize: number;
  projectId: string;
  sessionId: string;
  sha256: string;
  updatedAt: string;
}

const databaseName = "home-design-evidence-v1";
const fileStore = "files";
const maximumCopiedRecoveryBytes = 64 * 1024 * 1024;

interface StoredFile {
  blob?: Blob;
  bytes?: ArrayBuffer;
  lastModified: number;
  name: string;
  type: string;
}

function storageKey(projectId: string): string {
  return `hds:c2:upload:${projectId}`;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(fileStore);
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("Upload recovery storage is unavailable."));
    };
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(fileStore, mode);
    const request = action(transaction.objectStore(fileStore));
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("Upload recovery storage failed."));
    };
    transaction.oncomplete = () => {
      database.close();
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error("Upload recovery storage was interrupted."));
    };
  });
}

export async function saveRecovery(record: RecoveryRecord, file?: File): Promise<void> {
  localStorage.setItem(storageKey(record.projectId), JSON.stringify(record));
  if (file) {
    const storedFile: StoredFile = {
      blob: file.slice(0, file.size, file.type),
      lastModified: file.lastModified,
      name: file.name,
      type: file.type,
    };
    try {
      await withStore("readwrite", (store) => store.put(storedFile, record.sessionId));
    } catch {
      // Some emulated/mobile browsers cannot clone a file-backed Blob. Keep bounded recovery
      // reliable without ever copying a multi-gigabyte source into memory.
      if (file.size > maximumCopiedRecoveryBytes) return;
      const copiedFile: StoredFile = {
        bytes: await file.arrayBuffer(),
        lastModified: file.lastModified,
        name: file.name,
        type: file.type,
      };
      try {
        await withStore("readwrite", (store) => store.put(copiedFile, record.sessionId));
      } catch {
        // Session metadata is still recoverable. The UI will ask for the original file again.
      }
    }
  }
}

export async function loadRecovery(
  projectId: string,
): Promise<{ file?: File; record: RecoveryRecord } | undefined> {
  const raw = localStorage.getItem(storageKey(projectId));
  if (!raw) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    localStorage.removeItem(storageKey(projectId));
    return undefined;
  }
  const parsed = recoveryRecordSchema.safeParse(value);
  if (!parsed.success) {
    localStorage.removeItem(storageKey(projectId));
    return undefined;
  }
  let stored: StoredFile | undefined;
  try {
    stored = await withStore<StoredFile | undefined>(
      "readonly",
      (store) => store.get(parsed.data.sessionId) as IDBRequest<StoredFile | undefined>,
    );
  } catch {
    return { record: parsed.data };
  }
  const storedContent = stored?.bytes ?? stored?.blob;
  const file =
    stored && storedContent
      ? new File([storedContent], stored.name, {
          lastModified: stored.lastModified,
          type: stored.type,
        })
      : undefined;
  return { ...(file ? { file } : {}), record: parsed.data };
}

export async function clearRecovery(projectId: string, sessionId?: string): Promise<void> {
  localStorage.removeItem(storageKey(projectId));
  if (sessionId) {
    try {
      await withStore("readwrite", (store) => store.delete(sessionId));
    } catch {
      // Browser storage is best effort; server abort and local metadata removal remain authoritative.
    }
  }
}
