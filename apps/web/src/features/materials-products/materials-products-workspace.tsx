"use client";

import type {
  CatalogAssetVersion,
  Specification,
  SubstitutionPreview,
} from "@interior-design/contracts";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ActionButton,
  LoadingIndicator,
  PageContainer,
  StatePanel,
} from "../../components/ui-primitives";
import { ClientProblem, getProject, getSession } from "../auth/api";
import { MaterialsProductsProblem, materialsProductsClient } from "./api";
import { CatalogPanel } from "./catalog-panel";
import { catalogFiltersSchema, materialsProductsWorkspaceSchema } from "./contracts";
import type {
  CatalogAssetPage,
  CatalogEvidenceClassification,
  CatalogFilters,
  MaterialsProductsLaunchContext,
  MaterialsProductsWorkspaceData,
  SpecificationScheduleLines,
  SubstitutionConfirmationResult,
} from "./contracts";
import styles from "./materials-products.module.css";
import { PreviewPanel } from "./preview-panel";
import {
  clearMaterialsProductsRecovery,
  readMaterialsProductsRecovery,
  saveMaterialsProductsRecovery,
} from "./recovery";
import { Schedules } from "./schedules";
import { SelectionBoard } from "./selection-board";
import { shortHash } from "./presentation";

type LoadState =
  | { readonly kind: "error" | "forbidden" | "offline"; readonly message: string }
  | { readonly kind: "expired" | "loading" | "ready" };

type BusyAction = "board" | "confirm" | "preview" | "refresh" | "scene";

function loadStateFrom(reason: unknown): LoadState {
  if (reason instanceof MaterialsProductsProblem || reason instanceof ClientProblem) {
    if (reason.kind === "expired") return { kind: "expired" };
    if (reason.kind === "forbidden" || reason.kind === "not-found") {
      return { kind: "forbidden", message: reason.message };
    }
    if (reason.kind === "offline") return { kind: "offline", message: reason.message };
    return { kind: "error", message: reason.message };
  }
  return { kind: "error", message: "The materials and products workspace could not be loaded." };
}

function actionMessage(reason: unknown): string {
  if (reason instanceof MaterialsProductsProblem) {
    if (reason.kind === "conflict") {
      return "The specification, branch, catalog, rights record, or preview became stale. The exact latest state has been reloaded; review it before retrying.";
    }
    if (reason.kind === "preview-expired") {
      return "The bounded preview expired or its rights pin changed. Prepare a fresh preview; no substitution was committed.";
    }
    return reason.message;
  }
  return "The action could not be completed. No selection, specification, or canonical model change was inferred.";
}

const initialFilters = catalogFiltersSchema.parse({
  kind: "all",
  pageSize: 9,
  query: "",
  rights: "all",
  source: "all",
});

function focusLine(lineId: string | undefined): void {
  if (!lineId) return;
  window.requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(`[data-line-id="${CSS.escape(lineId)}"]`)?.focus();
  });
}

export function MaterialsProductsWorkspace({
  evidenceClassification,
  launchContext,
  projectId,
}: {
  readonly evidenceClassification: CatalogEvidenceClassification;
  readonly launchContext?: MaterialsProductsLaunchContext;
  readonly projectId: string;
}) {
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [workspace, setWorkspace] = useState<MaterialsProductsWorkspaceData>();
  const [specificationId, setSpecificationId] = useState<string>();
  const [specification, setSpecification] = useState<Specification>();
  const [schedule, setSchedule] = useState<SpecificationScheduleLines>();
  const [revisionCount, setRevisionCount] = useState(0);
  const [assetDetails, setAssetDetails] = useState<ReadonlyMap<string, CatalogAssetVersion>>(
    new Map(),
  );
  const [filters, setFilters] = useState<CatalogFilters>(initialFilters);
  const [catalogPage, setCatalogPage] = useState<CatalogAssetPage>();
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [cursorHistory, setCursorHistory] = useState<readonly string[]>([]);
  const [selectedLineId, setSelectedLineId] = useState<string>();
  const [candidateAssetVersionId, setCandidateAssetVersionId] = useState<string>();
  const [preview, setPreview] = useState<SubstitutionPreview>();
  const [confirmation, setConfirmation] = useState<SubstitutionConfirmationResult>();
  const [busy, setBusy] = useState<BusyAction>();
  const [alert, setAlert] = useState<string>();
  const [statusMessage, setStatusMessage] = useState("");
  const [online, setOnline] = useState(true);
  const alertRef = useRef<HTMLDivElement>(null);
  const previewAbort = useRef<AbortController | undefined>(undefined);
  const launchAttempted = useRef(false);

  const editable = workspace ? workspace.session.actor.role !== "viewer" : false;
  const selectedLine = specification?.currentRevision.lines.find(
    ({ lineId }) => lineId === selectedLineId,
  );
  const candidate = useMemo(
    () =>
      catalogPage?.assets.find(({ versionId }) => versionId === candidateAssetVersionId) ??
      assetDetails.get(candidateAssetVersionId ?? ""),
    [assetDetails, candidateAssetVersionId, catalogPage?.assets],
  );

  const loadWorkspace = useCallback(
    async (initial = false) => {
      if (initial) setLoadState({ kind: "loading" });
      else setBusy("refresh");
      setAlert(undefined);
      try {
        const [session, project, releases, specifications] = await Promise.all([
          getSession(),
          getProject(projectId),
          materialsProductsClient.listCatalogReleases(projectId),
          materialsProductsClient.listSpecifications(projectId),
        ]);
        let nextSpecifications = specifications;
        let nextSpecificationId: string | undefined;
        const recovered = readMaterialsProductsRecovery(window.sessionStorage, projectId);
        if (launchContext) {
          nextSpecificationId = specifications.specifications.find(
            (item) =>
              item.currentRevision.sourceConfirmation.confirmationId ===
              launchContext.confirmationId,
          )?.specificationId;
          const published = [...releases.releases]
            .filter(({ status }) => status === "published")
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
          if (
            !nextSpecificationId &&
            published &&
            session.actor.role !== "viewer" &&
            !launchAttempted.current
          ) {
            launchAttempted.current = true;
            const created = await materialsProductsClient.createSpecification(projectId, {
              catalogReleaseId: published.releaseId,
              catalogReleaseSha256: published.manifestSha256,
              confirmationId: launchContext.confirmationId,
            });
            nextSpecifications = {
              ...specifications,
              specifications: [created, ...specifications.specifications],
            };
            nextSpecificationId = created.specificationId;
            setStatusMessage(
              "The C13 API verified the confirmed C12 source and created revision 1 from the exact published catalog release.",
            );
          }
        }
        const next = materialsProductsWorkspaceSchema.parse({
          evidenceClassification,
          project,
          releases,
          session,
          specifications: nextSpecifications,
        });
        setWorkspace(next);
        const availableIds = new Set(
          next.specifications.specifications.map(({ specificationId }) => specificationId),
        );
        nextSpecificationId ??=
          recovered && availableIds.has(recovered.specificationId)
            ? recovered.specificationId
            : next.specifications.specifications[0]?.specificationId;
        setSpecificationId((current) =>
          current && availableIds.has(current) ? current : nextSpecificationId,
        );
        if (recovered && nextSpecificationId === recovered.specificationId) {
          setSelectedLineId(recovered.selectedLineId);
          setCandidateAssetVersionId(recovered.candidateAssetVersionId);
          setStatusMessage(
            "Recovered opaque selection identifiers for this tab. No notes, schedules, rights data, previews, or catalog payloads were persisted.",
          );
        }
        setLoadState({ kind: "ready" });
      } catch (reason) {
        setLoadState(loadStateFrom(reason));
      } finally {
        setBusy(undefined);
      }
    },
    [evidenceClassification, launchContext, projectId],
  );

  const loadSpecification = useCallback(
    async (nextSpecificationId: string, announce = false) => {
      try {
        const [nextSpecification, nextSchedule, revisions] = await Promise.all([
          materialsProductsClient.getSpecification(projectId, nextSpecificationId),
          materialsProductsClient.readSchedule(projectId, nextSpecificationId),
          materialsProductsClient.listSpecificationRevisions(projectId, nextSpecificationId),
        ]);
        if (
          nextSchedule.specificationId !== nextSpecification.specificationId ||
          nextSchedule.revision !== nextSpecification.currentRevision.revision
        ) {
          throw new MaterialsProductsProblem(
            "invalid-response",
            "The schedule did not match the exact specification revision.",
          );
        }
        const assetIds = [
          ...new Set(nextSchedule.lines.map(({ assetVersionId }) => assetVersionId)),
        ];
        const assets = await Promise.all(
          assetIds.map((assetVersionId) =>
            materialsProductsClient.getCatalogAsset(
              projectId,
              nextSpecification.currentRevision.catalogReleaseId,
              assetVersionId,
            ),
          ),
        );
        setSpecification(nextSpecification);
        setWorkspace((current) =>
          current === undefined
            ? current
            : {
                ...current,
                specifications: {
                  ...current.specifications,
                  specifications: current.specifications.specifications.map((item) =>
                    item.specificationId === nextSpecification.specificationId
                      ? nextSpecification
                      : item,
                  ),
                },
              },
        );
        setSchedule(nextSchedule);
        setRevisionCount(revisions.revisions.length);
        setAssetDetails(new Map(assets.map((asset) => [asset.versionId, asset])));
        const lineIds = new Set(nextSchedule.lines.map(({ lineId }) => lineId));
        setSelectedLineId((current) =>
          current && lineIds.has(current) ? current : nextSchedule.lines[0]?.lineId,
        );
        setPreview(undefined);
        setConfirmation(undefined);
        if (announce) {
          setStatusMessage(
            `Reloaded exact specification revision ${String(nextSpecification.currentRevision.revision)} and ${String(nextSchedule.lines.length)} schedule lines.`,
          );
        }
      } catch (reason) {
        if (reason instanceof MaterialsProductsProblem && reason.kind === "expired") {
          setLoadState({ kind: "expired" });
        } else {
          setAlert(actionMessage(reason));
        }
      }
    },
    [projectId],
  );

  const loadCatalog = useCallback(
    async (releaseId: string, nextFilters: CatalogFilters) => {
      setCatalogBusy(true);
      try {
        const page = await materialsProductsClient.listCatalogAssets(
          projectId,
          releaseId,
          nextFilters,
        );
        setCatalogPage(page);
      } catch (reason) {
        setAlert(actionMessage(reason));
      } finally {
        setCatalogBusy(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    setOnline(window.navigator.onLine);
    const handleOnline = () => {
      setOnline(true);
      setStatusMessage("Connection restored. Reload exact server state before continuing.");
    };
    const handleOffline = () => {
      setOnline(false);
      setStatusMessage("Offline. Existing inspection remains visible; mutations are disabled.");
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    void loadWorkspace(true);
  }, [loadWorkspace]);

  useEffect(() => {
    if (!specificationId || loadState.kind !== "ready") {
      setSpecification(undefined);
      setSchedule(undefined);
      return;
    }
    void loadSpecification(specificationId);
  }, [loadSpecification, loadState.kind, specificationId]);

  useEffect(() => {
    const releaseId = specification?.currentRevision.catalogReleaseId;
    if (!releaseId) return;
    const timeout = window.setTimeout(() => void loadCatalog(releaseId, filters), 220);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [filters, loadCatalog, specification?.currentRevision.catalogReleaseId]);

  useEffect(() => {
    if (!alert) return;
    alertRef.current?.focus();
  }, [alert]);

  useEffect(() => {
    if (!specificationId) return;
    saveMaterialsProductsRecovery(window.sessionStorage, {
      ...(candidateAssetVersionId ? { candidateAssetVersionId } : {}),
      projectId,
      savedAt: new Date().toISOString(),
      schemaVersion: "c13-materials-products-recovery-v1",
      ...(selectedLineId ? { selectedLineId } : {}),
      specificationId,
    });
  }, [candidateAssetVersionId, projectId, selectedLineId, specificationId]);

  async function saveBoard(
    entries: Specification["selectionBoard"]["entries"],
    announcement: string,
  ): Promise<void> {
    if (!specification || !editable || busy || !online) return;
    setBusy("board");
    setAlert(undefined);
    try {
      const next = await materialsProductsClient.updateSelectionBoard(
        projectId,
        specification,
        entries,
      );
      setSpecification(next);
      setSchedule({
        lines: next.currentRevision.lines,
        revision: next.currentRevision.revision,
        specificationId: next.specificationId,
      });
      setRevisionCount((count) => count + 1);
      setStatusMessage(
        `${announcement} Immutable revision ${String(next.currentRevision.revision)} created.`,
      );
      focusLine(selectedLineId);
    } catch (reason) {
      setAlert(actionMessage(reason));
      if (reason instanceof MaterialsProductsProblem && reason.kind === "conflict") {
        setPreview(undefined);
        await loadSpecification(specification.specificationId, true);
      }
    } finally {
      setBusy(undefined);
    }
  }

  async function preparePreview(): Promise<void> {
    if (!specification || !selectedLine || !candidate || !editable || busy || !online) return;
    setBusy("preview");
    setAlert(undefined);
    setConfirmation(undefined);
    const controller = new AbortController();
    previewAbort.current = controller;
    try {
      const next = await materialsProductsClient.createSubstitutionPreview(
        projectId,
        specification,
        candidate.versionId,
        selectedLine.elementId,
        controller.signal,
      );
      setPreview(next);
      setStatusMessage(
        "Bounded catalog preview prepared. It is non-canonical and cannot be treated as C10 scene evidence.",
      );
    } catch (reason) {
      setPreview(undefined);
      setAlert(actionMessage(reason));
    } finally {
      previewAbort.current = undefined;
      setBusy(undefined);
    }
  }

  async function confirmPreview(): Promise<void> {
    if (!specification || !preview || !editable || busy || !online) return;
    setBusy("confirm");
    setAlert(undefined);
    try {
      const next = await materialsProductsClient.confirmSubstitution(
        projectId,
        specification,
        preview,
      );
      setConfirmation(next);
      const committed = next.confirmation;
      setStatusMessage(
        next.sceneRequestState === "requested"
          ? `Exact C5 candidate committed and specification revision ${String(committed.specificationRevision)} created. Scene job ${committed.sceneJobId} was requested and is now linked explicitly.`
          : `Exact C5 candidate committed and specification revision ${String(committed.specificationRevision)} created. Exact C10 scene dispatch is unavailable and requires an explicit retry.`,
      );
      await loadSpecification(specification.specificationId);
      setConfirmation(next);
    } catch (reason) {
      setAlert(actionMessage(reason));
      if (
        reason instanceof MaterialsProductsProblem &&
        (reason.kind === "conflict" || reason.kind === "preview-expired")
      ) {
        setPreview(undefined);
        await loadSpecification(specification.specificationId, true);
      }
    } finally {
      setBusy(undefined);
    }
  }

  async function retryExactScene(): Promise<void> {
    if (
      !confirmation ||
      confirmation.sceneRequestState !== "retry-required" ||
      !editable ||
      busy ||
      !online
    )
      return;
    setBusy("scene");
    setAlert(undefined);
    const committed = confirmation.confirmation;
    try {
      await materialsProductsClient.requestExactScene(
        projectId,
        committed.specificationId,
        committed.specificationRevision,
        committed.sceneJobId,
      );
      const requested: SubstitutionConfirmationResult = {
        confirmation: committed,
        sceneRequestState: "requested",
      };
      setConfirmation(requested);
      setStatusMessage(
        `Exact C5 result remained committed. Exact C10 scene job ${committed.sceneJobId} was requested successfully and is now linked explicitly.`,
      );
    } catch (reason) {
      setAlert(
        `The exact C5 result remains committed, but exact C10 scene creation is still unavailable. ${actionMessage(reason)}`,
      );
      setStatusMessage(
        "Exact C5 result remains committed. Exact scene creation was not requested; retry when the service is available.",
      );
    } finally {
      setBusy(undefined);
    }
  }

  if (loadState.kind === "loading") {
    return (
      <PageContainer className={styles.statePage}>
        <LoadingIndicator label="Loading exact C12 confirmation, catalog release, specification, and role pins…" />
      </PageContainer>
    );
  }
  if (loadState.kind === "expired") {
    return (
      <PageContainer className={styles.statePage}>
        <StatePanel
          actions={
            <a className="ui-action" data-tone="primary" href="/sign-in">
              Sign in again
            </a>
          }
          message={<p>Your session expired before any specification or C5 substitution changed.</p>}
          status="Session expired"
          title="Return safely to the specification"
          tone="error"
        />
      </PageContainer>
    );
  }
  if (loadState.kind !== "ready" || !workspace) {
    return (
      <PageContainer className={styles.statePage}>
        <StatePanel
          actions={
            <ActionButton onClick={() => void loadWorkspace(true)} tone="primary">
              Retry workspace
            </ActionButton>
          }
          message={
            <p>
              {loadState.kind === "offline"
                ? "Reconnect, then retry. No selection, specification, or canonical state changed."
                : "message" in loadState
                  ? loadState.message
                  : "The materials and products workspace could not be loaded."}
            </p>
          }
          status={loadState.kind === "forbidden" ? "Read unavailable" : "Workspace unavailable"}
          title={
            loadState.kind === "offline" ? "You appear to be offline" : "Pinned state stayed safe"
          }
          tone="error"
        />
      </PageContainer>
    );
  }

  const specifications = workspace.specifications.specifications;
  return (
    <PageContainer
      className={styles.shell}
      data-as-built-mutations="0"
      data-existing-mutations="0"
      data-payload-persistence="none"
      data-testid="materials-products-workspace"
    >
      <p aria-atomic="true" aria-live="polite" className={styles.visuallyHidden} role="status">
        {statusMessage}
      </p>
      <header className={styles.hero}>
        <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
          <Link href="/projects">Projects</Link>
          <span aria-hidden="true">/</span>
          <Link href={`/design-options/${projectId}`}>Confirmed design option</Link>
          <span aria-hidden="true">/</span>
          <span>Materials &amp; products</span>
        </nav>
        <div className={styles.heroGrid}>
          <div>
            <h1>Specify what belongs in each room</h1>
            <p>
              Review exact catalog pins, rights, bounded representations, decisions and schedules.
              Preview one safe replacement at a time without confusing appearance with canonical
              geometry.
            </p>
          </div>
          <dl className={styles.heroMeta}>
            <div>
              <dt>Project</dt>
              <dd>{workspace.project.name}</dd>
            </div>
            <div>
              <dt>Access</dt>
              <dd>
                {workspace.session.actor.role} · {editable ? "can edit" : "inspect-only"}
              </dd>
            </div>
            <div>
              <dt>History</dt>
              <dd>{revisionCount} immutable revisions</dd>
            </div>
          </dl>
        </div>
        <div className={styles.capabilityBar} role="note">
          <div>
            <strong>Local, rights-reviewed catalog</strong>
            <span>No URL ingestion, provider, paid service, customer data, or training use</span>
          </div>
          <div>
            <strong>Commercial data not provided</strong>
            <span>No price, supplier, stock, availability, or delivery claim</span>
          </div>
          <div>
            <strong>
              {workspace.evidenceClassification === "synthetic-fixture"
                ? "Synthetic fixture presentation"
                : "Production-composed backend evidence"}
            </strong>
            <span>Catalog preview stays distinct from canonical C5 and exact C10 results</span>
          </div>
        </div>
      </header>

      {!online ? (
        <div className={styles.offlineBanner} role="status">
          <strong>Offline inspection mode</strong>
          <span>Reconnect and reload exact pins before editing, previewing, or confirming.</span>
        </div>
      ) : null}
      {!editable ? (
        <div className={styles.readOnlyBanner} role="note">
          <strong>Viewer access is inspect-only.</strong>
          <span>Selection, note, preview, and confirmation actions are disabled.</span>
        </div>
      ) : null}
      {alert ? (
        <div aria-atomic="true" className={styles.alert} ref={alertRef} role="alert" tabIndex={-1}>
          <div>
            <strong>Action not completed</strong>
            <span>{alert}</span>
          </div>
          <button
            disabled={busy !== undefined}
            onClick={() => specificationId && void loadSpecification(specificationId, true)}
            type="button"
          >
            Reload exact state
          </button>
        </div>
      ) : null}

      {specifications.length === 0 || !specificationId ? (
        <section className={styles.emptyWorkspace}>
          <div>
            <p className={styles.sectionLabel}>No working specification</p>
            <h2>Start from one exact confirmed C12 option</h2>
            <p>
              Open this workspace from a confirmed option. A typed confirmation identifier is only a
              request context; the C13 API must verify its branch, commit, snapshot and release pins
              before revision 1 can exist.
            </p>
          </div>
          {launchContext && !editable ? (
            <p>
              Viewer access cannot create a specification from the supplied confirmation context.
            </p>
          ) : null}
          <Link href={`/design-options/${projectId}`}>Return to design options</Link>
        </section>
      ) : (
        <>
          <section aria-label="Specification version controls" className={styles.versionBar}>
            <label>
              <span>Working specification</span>
              <select
                onChange={(event) => {
                  setSpecificationId(event.currentTarget.value);
                  setSelectedLineId(undefined);
                  setCandidateAssetVersionId(undefined);
                  setCursorHistory([]);
                }}
                value={specificationId}
              >
                {specifications.map((item) => (
                  <option key={item.specificationId} value={item.specificationId}>
                    Revision {item.currentRevision.revision} · confirmation{" "}
                    {shortHash(item.currentRevision.sourceConfirmation.confirmationId)}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={busy !== undefined}
              onClick={() => void loadWorkspace(false)}
              type="button"
            >
              {busy === "refresh" ? "Refreshing…" : "Refresh all pins"}
            </button>
            <button
              className={styles.clearRecovery}
              onClick={() => {
                clearMaterialsProductsRecovery(window.sessionStorage, projectId);
                setStatusMessage(
                  "Tab-local selection recovery cleared. Server data was unchanged.",
                );
              }}
              type="button"
            >
              Clear tab recovery
            </button>
          </section>
          {specification && schedule ? (
            <>
              <SelectionBoard
                busy={busy === "board" || !online}
                editable={editable}
                onSave={(entries, announcement) => void saveBoard(entries, announcement)}
                onSelectLine={(lineId) => {
                  setSelectedLineId(lineId);
                  setCandidateAssetVersionId(undefined);
                  setPreview(undefined);
                  setConfirmation(undefined);
                  setStatusMessage(
                    "Specification line selected. Candidate and preview were reset.",
                  );
                }}
                {...(selectedLineId ? { selectedLineId } : {})}
                specification={specification}
              />
              <CatalogPanel
                busy={catalogBusy}
                {...(candidateAssetVersionId ? { candidateAssetVersionId } : {})}
                editable={editable && online}
                filters={filters}
                onCandidateChange={(assetVersionId) => {
                  setCandidateAssetVersionId(assetVersionId);
                  setPreview(undefined);
                  setConfirmation(undefined);
                  setStatusMessage(
                    "Catalog candidate selected. No preview or canonical mutation occurred.",
                  );
                }}
                onFiltersChange={(next) => {
                  setCursorHistory([]);
                  setFilters(next);
                }}
                onNextPage={() => {
                  if (!catalogPage?.nextCursor) return;
                  setCursorHistory((current) => [...current, filters.cursor ?? "__first__"]);
                  setFilters((current) => ({ ...current, cursor: catalogPage.nextCursor }));
                }}
                onPreviousPage={() => {
                  const previous = cursorHistory.at(-1);
                  setCursorHistory((current) => current.slice(0, -1));
                  setFilters((current) => ({
                    ...current,
                    cursor: previous && previous !== "__first__" ? previous : undefined,
                  }));
                }}
                {...(catalogPage ? { page: catalogPage } : {})}
                pageNumber={cursorHistory.length + 1}
                {...(selectedLine ? { selectedLine } : {})}
              />
              <PreviewPanel
                {...(busy === "preview" || busy === "confirm" || busy === "scene" ? { busy } : {})}
                {...(candidate ? { candidate } : {})}
                {...(confirmation ? { confirmation } : {})}
                editable={editable && online}
                onConfirm={() => void confirmPreview()}
                onInterrupt={() => previewAbort.current?.abort()}
                onPreview={() => void preparePreview()}
                onRetryScene={() => void retryExactScene()}
                {...(preview ? { preview } : {})}
                projectId={projectId}
                {...(selectedLine ? { selectedLine } : {})}
              />
              <Schedules
                assets={assetDetails}
                lines={schedule.lines}
                revision={schedule.revision}
              />
            </>
          ) : (
            <div className={styles.loadingSection}>
              <LoadingIndicator label="Loading exact lines, schedule projections, rights pins, and asset versions…" />
            </div>
          )}
        </>
      )}
      <footer className={styles.boundaryFooter}>
        <strong>Truth and professional boundary</strong>
        <p>
          This is a working specification, not an approval, purchase, quote, availability check,
          professional issue, or quantity take-off. Existing and as-built states, the originating
          C12 option, and sibling branches remain unchanged.
        </p>
      </footer>
    </PageContainer>
  );
}
