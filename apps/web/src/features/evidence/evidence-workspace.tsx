"use client";

import type {
  Asset,
  AssetKind,
  AssetRightsAssertion,
  Project,
  Session,
} from "@interior-design/contracts";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SyntheticEvent } from "react";

import { ActionButton, LoadingIndicator, PageContainer } from "../../components/ui-primitives";
import { ClientProblem, getProject, getSession } from "../auth/api";
import { abortUpload, EvidenceProblem, issueAssetAccess, listAssets } from "./api";
import { clearRecovery, loadRecovery } from "./recovery";
import type { RecoveryRecord } from "./recovery";
import {
  acceptedTypes,
  prepareUpload,
  reconcileUpload,
  SelectionProblem,
  uploadRemaining,
  validateFile,
} from "./upload";
import type { UploadProgress } from "./upload";

export function EvidenceFileName({ value }: { value: string }) {
  return <bdi className="evidence-file-name">{value}</bdi>;
}

type WorkspaceState =
  | { kind: "error" | "forbidden" | "offline"; message: string }
  | { kind: "expired" }
  | { kind: "loading" }
  | { assets: Asset[]; kind: "ready"; project: Project; session: Session };

type TransferState =
  | { kind: "idle" }
  | { kind: "recoverable"; file?: File; record: RecoveryRecord }
  | { kind: "working"; progress: UploadProgress }
  | { kind: "paused"; file: File; record: RecoveryRecord }
  | { kind: "failed"; file?: File; message: string; record?: RecoveryRecord };

const kindOptions: Array<{ detail: string; kind: AssetKind; label: string }> = [
  { detail: "PDF, PNG, JPEG or isolated SVG", kind: "plan", label: "Plan" },
  { detail: "JPEG, PNG, HEIC or HEIF", kind: "photograph", label: "Photograph" },
  { detail: "MP4 or QuickTime, up to 30 minutes", kind: "video", label: "Video" },
  { detail: "PDF, up to 500 pages", kind: "document", label: "Document" },
];

const statusCopy: Record<Asset["status"], { label: string; message: string }> = {
  aborted: {
    label: "Aborted",
    message: "The incomplete transfer was stopped. No processing will start.",
  },
  "pending-upload": { label: "Pending", message: "Waiting for file parts to be transferred." },
  processing: {
    label: "Processing",
    message: "The source checksum and media safety limits are being checked.",
  },
  quarantined: {
    label: "Quarantined",
    message: "Access is restricted while a typed safety result is reviewed.",
  },
  ready: { label: "Ready", message: "A validated representation is available on request." },
  rejected: {
    label: "Rejected",
    message: "The file was not accepted. The original is not available here.",
  },
  uploaded: {
    label: "Uploaded",
    message: "The immutable source is queued for bounded processing.",
  },
  uploading: { label: "Uploading", message: "The multipart transfer is still in progress." },
};

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${String(Math.max(1, Math.round(bytes / 1024)))} KiB`;
}

function rejectionMessage(code: Asset["rejectionCode"]): string | undefined {
  const messages: Record<NonNullable<Asset["rejectionCode"]>, string> = {
    "checksum-mismatch": "The received bytes did not match the declared SHA-256 checksum.",
    "malformed-media": "The file could not be parsed safely as the declared media type.",
    "malware-suspected":
      "A scanner adapter reported suspicious content; this is not an antivirus-clean claim.",
    "processing-failed":
      "Processing could not finish safely. Retry with a new upload or contact support.",
    "resource-limit": "The file exceeded a bounded dimension, duration, page or processing limit.",
    "signature-mismatch": "The file signature did not match its declared type.",
    "unsupported-type": "The local decoder or media type is unavailable for this file.",
  };
  return code ? messages[code] : undefined;
}

export function EvidenceWorkspace({ projectId }: { projectId: string }) {
  const [state, setState] = useState<WorkspaceState>({ kind: "loading" });
  const [transfer, setTransfer] = useState<TransferState>({ kind: "idle" });
  const [kind, setKind] = useState<AssetKind>("plan");
  const [file, setFile] = useState<File>();
  const [rightsBasis, setRightsBasis] = useState<AssetRightsAssertion["basis"]>("owned-by-user");
  const [serviceConsent, setServiceConsent] = useState(false);
  const [trainingConsent, setTrainingConsent] =
    useState<AssetRightsAssertion["trainingUseConsent"]>("denied");
  const [attribution, setAttribution] = useState("");
  const [licenceUrl, setLicenceUrl] = useState("");
  const [selectionError, setSelectionError] = useState<string>();
  const [accessing, setAccessing] = useState<string>();
  const [accessError, setAccessError] = useState<string>();
  const [previewAccess, setPreviewAccess] = useState<{
    assetId: string;
    expiresAt: string;
    url: string;
  }>();
  const abortController = useRef<AbortController | undefined>(undefined);
  const activeRecovery = useRef<{ file: File; record: RecoveryRecord } | undefined>(undefined);
  const errorRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const [project, session, assets] = await Promise.all([
        getProject(projectId),
        getSession(),
        listAssets(projectId),
      ]);
      setState({ assets, kind: "ready", project, session });
      const recovered = await loadRecovery(projectId);
      if (recovered) {
        activeRecovery.current = recovered.file
          ? { file: recovered.file, record: recovered.record }
          : undefined;
        setTransfer({
          ...(recovered.file ? { file: recovered.file } : {}),
          kind: "recoverable",
          record: recovered.record,
        });
      }
    } catch (reason) {
      const problem =
        reason instanceof EvidenceProblem || reason instanceof ClientProblem ? reason : undefined;
      if (problem?.kind === "expired") setState({ kind: "expired" });
      else if (problem?.kind === "forbidden")
        setState({ kind: "forbidden", message: problem.message });
      else if (problem?.kind === "offline") setState({ kind: "offline", message: problem.message });
      else
        setState({ kind: "error", message: problem?.message ?? "Evidence could not be loaded." });
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (selectionError || transfer.kind === "failed") errorRef.current?.focus();
  }, [selectionError, transfer]);

  const canUpload = state.kind === "ready" && state.session.actor.role !== "viewer";
  const progressPercent =
    transfer.kind === "working"
      ? Math.round((transfer.progress.completedBytes / transfer.progress.totalBytes) * 100)
      : 0;

  const selectedDescription = useMemo(
    () => kindOptions.find((option) => option.kind === kind)?.detail ?? "",
    [kind],
  );

  function rights(): AssetRightsAssertion {
    return {
      ...(attribution.trim() ? { attribution: attribution.trim() } : {}),
      basis: rightsBasis,
      ...(licenceUrl.trim() ? { licenceUrl: licenceUrl.trim() } : {}),
      serviceProcessingConsent: true,
      trainingUseConsent: trainingConsent,
    };
  }

  async function continueUpload(selectedFile: File, record: RecoveryRecord) {
    const controller = new AbortController();
    abortController.current = controller;
    activeRecovery.current = { file: selectedFile, record };
    try {
      setTransfer({
        kind: "working",
        progress: { completedBytes: 0, phase: "uploading", totalBytes: selectedFile.size },
      });
      await uploadRemaining(selectedFile, record, controller.signal, (progress) => {
        setTransfer({ kind: "working", progress });
      });
      activeRecovery.current = undefined;
      setTransfer({ kind: "idle" });
      setFile(undefined);
      await load();
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") {
        const recovered = await loadRecovery(projectId);
        if (recovered?.file)
          setTransfer({ file: recovered.file, kind: "paused", record: recovered.record });
        return;
      }
      const recovered = await loadRecovery(projectId);
      setTransfer({
        ...(recovered?.file ? { file: recovered.file } : {}),
        kind: "failed",
        message: reason instanceof Error ? reason.message : "The upload could not continue.",
        ...(recovered?.record ? { record: recovered.record } : {}),
      });
    }
  }

  async function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    setSelectionError(undefined);
    if (!file) {
      setSelectionError("Choose a file before continuing.");
      return;
    }
    if (!serviceConsent) {
      setSelectionError("Confirm service processing to upload this evidence.");
      return;
    }
    try {
      validateFile(file, kind);
      const controller = new AbortController();
      abortController.current = controller;
      setTransfer({
        kind: "working",
        progress: { completedBytes: 0, phase: "hashing", totalBytes: file.size },
      });
      const prepared = await prepareUpload(
        projectId,
        file,
        kind,
        rights(),
        controller.signal,
        (progress) => {
          setTransfer({ kind: "working", progress });
        },
      );
      activeRecovery.current = { file: prepared.file, record: prepared.record };
      await continueUpload(prepared.file, prepared.record);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      if (reason instanceof SelectionProblem) {
        setSelectionError(reason.message);
        setTransfer({ kind: "idle" });
      } else {
        setTransfer({
          kind: "failed",
          message: reason instanceof Error ? reason.message : "The upload could not start.",
        });
      }
    }
  }

  async function resume(record: RecoveryRecord, recoveredFile?: File) {
    if (!recoveredFile) {
      setTransfer({
        kind: "failed",
        message:
          "The saved file is no longer available in this browser. Cancel this transfer and select it again.",
        record,
      });
      return;
    }
    try {
      const reconciliation = await reconcileUpload(record);
      const { session } = reconciliation;
      if (session.state === "aborted" || session.state === "expired") {
        await clearRecovery(projectId, record.sessionId);
        activeRecovery.current = undefined;
        setTransfer({
          kind: "failed",
          message: `This upload session is ${session.state}. Select the file to start a new transfer.`,
        });
        return;
      }
      if (session.state === "completed") {
        await clearRecovery(projectId, record.sessionId);
        activeRecovery.current = undefined;
        setTransfer({ kind: "idle" });
        await load();
        return;
      }
      activeRecovery.current = { file: recoveredFile, record: reconciliation.record };
      await continueUpload(recoveredFile, reconciliation.record);
    } catch (reason) {
      setTransfer({
        file: recoveredFile,
        kind: "failed",
        message:
          reason instanceof Error ? reason.message : "The saved upload could not be reconciled.",
        record,
      });
    }
  }

  async function cancel(record?: RecoveryRecord) {
    abortController.current?.abort();
    if (record) {
      try {
        await abortUpload(projectId, record.sessionId, `abort-${record.sessionId}`);
      } catch {
        // Recovery state is cleared only after the server abort attempt; the inventory remains authoritative.
      }
      await clearRecovery(projectId, record.sessionId);
    }
    setTransfer({ kind: "idle" });
    activeRecovery.current = undefined;
    await load();
  }

  async function pause() {
    abortController.current?.abort();
    const active = activeRecovery.current;
    if (active) setTransfer({ file: active.file, kind: "paused", record: active.record });
    const recovered = await loadRecovery(projectId);
    if (recovered?.file) {
      activeRecovery.current = { file: recovered.file, record: recovered.record };
      setTransfer({ file: recovered.file, kind: "paused", record: recovered.record });
    }
  }

  async function access(asset: Asset) {
    setAccessError(undefined);
    setPreviewAccess(undefined);
    setAccessing(asset.id);
    try {
      const access = await issueAssetAccess(projectId, asset.id, "preview", crypto.randomUUID());
      setPreviewAccess({ assetId: asset.id, expiresAt: access.expiresAt, url: access.url });
    } catch (reason) {
      setAccessError(
        reason instanceof Error ? reason.message : "Short-lived access could not be issued.",
      );
    } finally {
      setAccessing(undefined);
    }
  }

  function retryFailedUpload() {
    if (transfer.kind !== "failed" || !transfer.record) return;
    void resume(transfer.record, transfer.file);
  }

  if (state.kind === "loading")
    return (
      <PageContainer className="workspace-state">
        <LoadingIndicator label="Loading project evidence" />
      </PageContainer>
    );
  if (state.kind !== "ready") {
    const title =
      state.kind === "expired"
        ? "Your session has expired"
        : state.kind === "offline"
          ? "You’re offline"
          : state.kind === "forbidden"
            ? "Evidence is unavailable"
            : "Evidence could not be loaded";
    const message =
      state.kind === "expired"
        ? "Sign in again. No upload state or evidence was changed."
        : state.message;
    return (
      <PageContainer className="workspace-state">
        <section className="standalone-state" role="status">
          <h1>{title}</h1>
          <p>{message}</p>
          {state.kind === "expired" ? (
            <Link className="ui-action" data-tone="primary" href="/sign-in">
              Sign in again
            </Link>
          ) : (
            <ActionButton onClick={() => void load()}>Try again</ActionButton>
          )}
        </section>
      </PageContainer>
    );
  }

  return (
    <PageContainer className="evidence-layout">
      <aside className="evidence-rail" aria-label="Evidence workspace navigation">
        <Link className="back-link" href="/projects">
          ← Projects
        </Link>
        <div>
          <strong>{state.project.name}</strong>
          <span>Evidence workspace</span>
          <span>{state.session.actor.role} access</span>
        </div>
        <nav aria-label="On this page">
          <a href="#add-evidence">Add evidence</a>
          <a href="#inventory">Inventory</a>
        </nav>
        <p>
          Local fixture · Synthetic evidence only. No antivirus, 3D understanding, RoomPlan or
          physical-device result is claimed.
        </p>
      </aside>

      <main className="evidence-main">
        <div className="fixture-banner" role="note">
          <strong>Local fixture · Synthetic files only</strong>
          <span>Source validation and processing are separate from model training permission.</span>
        </div>
        <header className="evidence-heading">
          <div>
            <h1>Project evidence</h1>
            <p>
              Add rights-cleared source material, follow its immutable transfer, and request access
              only when you need it.
            </p>
          </div>
          <span>
            {state.assets.length} {state.assets.length === 1 ? "item" : "items"}
          </span>
        </header>

        {transfer.kind === "recoverable" || transfer.kind === "paused" ? (
          <section className="recovery-banner" aria-labelledby="recovery-title">
            <div>
              <h2 id="recovery-title">Upload ready to resume</h2>
              <p>
                <EvidenceFileName value={transfer.record.fileName} /> · saved{" "}
                {new Date(transfer.record.updatedAt).toLocaleString("en-GB")}. The server session is
                checked before fresh signed URLs are requested.
              </p>
            </div>
            <div>
              <ActionButton onClick={() => void resume(transfer.record, transfer.file)}>
                Resume
              </ActionButton>
              <button
                className="text-action"
                onClick={() => void cancel(transfer.record)}
                type="button"
              >
                Cancel upload
              </button>
            </div>
          </section>
        ) : null}

        <section className="evidence-upload" id="add-evidence" aria-labelledby="add-evidence-title">
          <header>
            <h2 id="add-evidence-title">Add evidence</h2>
            <p>
              File type and size are checked before hashing. Media signatures and parser limits are
              checked later by bounded processing.
            </p>
          </header>
          {canUpload ? (
            <form onSubmit={(event) => void submit(event)}>
              <fieldset disabled={transfer.kind === "working"}>
                <legend>1. Choose the source type</legend>
                <div className="evidence-kind-grid">
                  {kindOptions.map((option) => (
                    <label data-selected={kind === option.kind} key={option.kind}>
                      <input
                        checked={kind === option.kind}
                        name="kind"
                        onChange={() => {
                          setKind(option.kind);
                          setFile(undefined);
                          setSelectionError(undefined);
                        }}
                        type="radio"
                        value={option.kind}
                      />
                      <span>
                        <strong>{option.label}</strong>
                        <small>{option.detail}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset disabled={transfer.kind === "working"}>
                <legend>2. Select a file</legend>
                <label className="file-picker">
                  <input
                    accept={acceptedTypes(kind)}
                    onChange={(event) => {
                      const selected = event.target.files?.[0];
                      setFile(selected);
                      setSelectionError(undefined);
                      if (selected)
                        try {
                          validateFile(selected, kind);
                        } catch (reason) {
                          if (reason instanceof Error) setSelectionError(reason.message);
                        }
                    }}
                    type="file"
                  />
                  <span>
                    {file ? (
                      <>
                        <strong>
                          <EvidenceFileName value={file.name} />
                        </strong>
                        <small>
                          {formatBytes(file.size)} · {file.type}
                        </small>
                      </>
                    ) : (
                      <>
                        <strong>Choose {kind}</strong>
                        <small>{selectedDescription} · maximum 2 GiB</small>
                      </>
                    )}
                  </span>
                </label>
              </fieldset>
              <fieldset disabled={transfer.kind === "working"}>
                <legend>3. Confirm rights and processing</legend>
                <div className="rights-grid">
                  <label>
                    <span>Rights basis</span>
                    <select
                      onChange={(event) => {
                        setRightsBasis(event.target.value as AssetRightsAssertion["basis"]);
                      }}
                      value={rightsBasis}
                    >
                      <option value="owned-by-user">I own this file</option>
                      <option value="permission-granted">I have permission</option>
                      <option value="public-domain">Public domain</option>
                      <option value="licensed">Licensed for this use</option>
                    </select>
                  </label>
                  <label>
                    <span>
                      Attribution <small>optional</small>
                    </span>
                    <input
                      maxLength={500}
                      onChange={(event) => {
                        setAttribution(event.target.value);
                      }}
                      value={attribution}
                    />
                  </label>
                  <label className="field-wide">
                    <span>
                      HTTPS licence URL <small>optional</small>
                    </span>
                    <input
                      inputMode="url"
                      onChange={(event) => {
                        setLicenceUrl(event.target.value);
                      }}
                      placeholder="https://…"
                      type="url"
                      value={licenceUrl}
                    />
                  </label>
                </div>
                <label className="consent-row">
                  <input
                    checked={serviceConsent}
                    onChange={(event) => {
                      setServiceConsent(event.target.checked);
                    }}
                    type="checkbox"
                  />
                  <span>
                    <strong>Allow service processing for this project</strong>
                    <small>
                      Required to store, checksum, inspect within limits and prepare safe derived
                      previews.
                    </small>
                  </span>
                </label>
                <div className="training-choice">
                  <span>
                    <strong>Model training permission</strong>
                    <small>Separate from service processing. Denied by default.</small>
                  </span>
                  <label>
                    <input
                      checked={trainingConsent === "denied"}
                      name="training"
                      onChange={() => {
                        setTrainingConsent("denied");
                      }}
                      type="radio"
                    />{" "}
                    Denied
                  </label>
                  <label>
                    <input
                      checked={trainingConsent === "granted"}
                      name="training"
                      onChange={() => {
                        setTrainingConsent("granted");
                      }}
                      type="radio"
                    />{" "}
                    Granted
                  </label>
                </div>
              </fieldset>
              {selectionError || transfer.kind === "failed" ? (
                <div className="inline-alert" ref={errorRef} role="alert" tabIndex={-1}>
                  <strong>Upload needs attention</strong>
                  <span>
                    {selectionError ?? (transfer.kind === "failed" ? transfer.message : "")}
                  </span>
                </div>
              ) : null}
              {transfer.kind === "working" ? (
                <div className="transfer-progress" aria-live="polite">
                  <div>
                    <strong>
                      {transfer.progress.phase === "hashing"
                        ? "Hashing locally"
                        : transfer.progress.phase === "completing"
                          ? "Finalising once"
                          : "Uploading immutable source"}
                    </strong>
                    <span>
                      {progressPercent}% · {formatBytes(transfer.progress.completedBytes)} of{" "}
                      {formatBytes(transfer.progress.totalBytes)}
                    </span>
                  </div>
                  <progress
                    aria-label="Upload progress"
                    max={transfer.progress.totalBytes}
                    value={transfer.progress.completedBytes}
                  />
                  <button className="text-action" onClick={() => void pause()} type="button">
                    Pause
                  </button>
                </div>
              ) : null}
              <div className="evidence-actions">
                <p>Bearer credentials and signed URLs are kept out of browser storage.</p>
                <ActionButton
                  disabled={!file || !serviceConsent || transfer.kind === "working"}
                  type="submit"
                >
                  Hash and upload
                </ActionButton>
                {transfer.kind === "failed" && transfer.record ? (
                  <ActionButton onClick={retryFailedUpload} tone="secondary" type="button">
                    Retry saved upload
                  </ActionButton>
                ) : null}
              </div>
            </form>
          ) : (
            <div className="viewer-note">
              <strong>Viewer access</strong>
              <p>
                You can inspect ready evidence and request a derived preview. Upload, completion,
                abort and original-source access are unavailable.
              </p>
            </div>
          )}
        </section>

        <section className="evidence-inventory" id="inventory" aria-labelledby="inventory-title">
          <header>
            <div>
              <h2 id="inventory-title">Evidence inventory</h2>
              <p>
                Statuses describe transfer and bounded processing only—not spatial understanding or
                professional verification.
              </p>
            </div>
            <button className="text-action" onClick={() => void load()} type="button">
              Refresh status
            </button>
          </header>
          {accessError ? (
            <div className="inline-alert" role="alert">
              <strong>Access unavailable</strong>
              <span>{accessError}</span>
            </div>
          ) : null}
          {state.assets.length === 0 ? (
            <div className="evidence-empty">
              <h3>No evidence yet</h3>
              <p>Add a small synthetic plan, photograph, video or document to begin.</p>
            </div>
          ) : (
            <div className="asset-list">
              {state.assets.map((asset) => {
                const copy = statusCopy[asset.status];
                const rejected = rejectionMessage(asset.rejectionCode);
                return (
                  <article className="asset-row" key={asset.id}>
                    <div className="asset-icon" aria-hidden="true">
                      {asset.kind.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="asset-details">
                      <div>
                        <h3>
                          <EvidenceFileName value={asset.fileName} />
                        </h3>
                        <span className="status-chip" data-status={asset.status}>
                          {copy.label}
                        </span>
                      </div>
                      <p>{copy.message}</p>
                      {rejected ? <p className="asset-rejection">{rejected}</p> : null}
                      <dl>
                        <div>
                          <dt>Type</dt>
                          <dd>{asset.kind}</dd>
                        </div>
                        <div>
                          <dt>Size</dt>
                          <dd>{formatBytes(asset.source.byteSize)}</dd>
                        </div>
                        <div>
                          <dt>Training</dt>
                          <dd>{asset.rights.trainingUseConsent}</dd>
                        </div>
                        <div>
                          <dt>Source hash</dt>
                          <dd>
                            <code>{asset.source.sha256.slice(0, 12)}…</code>
                          </dd>
                        </div>
                      </dl>
                    </div>
                    <div className="asset-actions">
                      {asset.status === "ready" ? (
                        previewAccess?.assetId === asset.id ? (
                          <a
                            className="ui-action"
                            data-tone="secondary"
                            href={previewAccess.url}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Open short-lived preview
                          </a>
                        ) : (
                          <ActionButton
                            disabled={accessing === asset.id}
                            onClick={() => void access(asset)}
                            tone="secondary"
                          >
                            {accessing === asset.id ? "Requesting…" : "Request preview"}
                          </ActionButton>
                        )
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </PageContainer>
  );
}
