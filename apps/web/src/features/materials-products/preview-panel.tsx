import type {
  CatalogAssetVersion,
  SpecificationLine,
  SubstitutionConfirmation,
  SubstitutionPreview,
} from "@interior-design/contracts";
import Link from "next/link";
import { useState } from "react";

import styles from "./materials-products.module.css";
import { artifactReadiness, formattedTime, previewTruth, shortHash } from "./presentation";

export function PreviewPanel({
  busy,
  candidate,
  confirmation,
  editable,
  onConfirm,
  onInterrupt,
  onPreview,
  preview,
  projectId,
  selectedLine,
}: {
  readonly busy?: "confirm" | "preview";
  readonly candidate?: CatalogAssetVersion;
  readonly confirmation?: SubstitutionConfirmation;
  readonly editable: boolean;
  readonly onConfirm: () => void;
  readonly onInterrupt: () => void;
  readonly onPreview: () => void;
  readonly preview?: SubstitutionPreview;
  readonly projectId: string;
  readonly selectedLine?: SpecificationLine;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const before = selectedLine?.kind ?? "current element";
  const after = candidate?.displayName ?? "no candidate selected";
  return (
    <section aria-labelledby="preview-title" className={styles.previewPanel}>
      <header className={styles.sectionHeader}>
        <div>
          <p className={styles.sectionLabel}>Non-mutating comparison</p>
          <h2 id="preview-title">Before / candidate preview</h2>
        </div>
        <span className={styles.truthLabel}>{previewTruth(preview)}</span>
      </header>
      <figure className={styles.previewFigure}>
        <div className={styles.previewScene} data-preview={String(preview !== undefined)}>
          <div className={styles.roomOutline} aria-hidden="true">
            <span className={styles.currentObject}>Before</span>
            {candidate ? <span className={styles.candidateObject}>Candidate</span> : null}
          </div>
          <div className={styles.previewLegend}>
            <span>
              <i data-tone="before" /> {before}
            </span>
            <span>
              <i data-tone="candidate" /> {after}
            </span>
          </div>
        </div>
        <figcaption>
          Bounded envelope comparison only. This schematic is not a render, exact appearance,
          canonical C5 truth, or C10 scene evidence.
        </figcaption>
      </figure>
      {candidate ? (
        <div className={styles.candidateSummary}>
          <div>
            <strong>{candidate.displayName}</strong>
            <span>{candidate.description}</span>
          </div>
          <p>{artifactReadiness(candidate).join(" · ")}</p>
        </div>
      ) : null}
      {preview ? (
        <div className={styles.previewResult}>
          <div>
            <strong>Bounded catalog preview prepared</strong>
            <span>Expires {formattedTime(preview.expiresAt)}</span>
          </div>
          <dl>
            <div>
              <dt>Candidate snapshot hash</dt>
              <dd title={preview.candidateSnapshotSha256}>
                <code>{shortHash(preview.candidateSnapshotSha256)}</code>
              </dd>
            </div>
            <div>
              <dt>C5 model preview</dt>
              <dd>
                <code>{preview.modelPreviewId}</code>
              </dd>
            </div>
          </dl>
          {preview.findings.length > 0 ? (
            <div>
              <h3>Geometry findings</h3>
              <ul>
                {preview.findings.map((finding) => (
                  <li key={finding}>{finding}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p>No blocking integer-geometry finding was reported for this bounded preview.</p>
          )}
          <label className={styles.confirmCheck}>
            <input
              checked={acknowledged}
              disabled={!editable || busy !== undefined}
              onChange={(event) => {
                setAcknowledged(event.currentTarget.checked);
              }}
              type="checkbox"
            />
            <span>
              I understand confirmation creates an immutable specification revision and commits the
              exact C5 candidate; this preview itself is not canonical.
            </span>
          </label>
        </div>
      ) : null}
      {confirmation ? (
        <div className={styles.confirmation} role="status">
          <div>
            <strong>Confirmed into exact C5 result</strong>
            <span>
              Specification revision {confirmation.specificationRevision} · snapshot{" "}
              {shortHash(confirmation.resultSnapshotSha256)}
            </span>
          </div>
          <Link href={`/viewer/${projectId}?jobId=${confirmation.sceneJobId}`}>
            Open exact C10 scene job {confirmation.sceneJobId}
          </Link>
        </div>
      ) : null}
      <div className={styles.previewActions}>
        <button
          disabled={!editable || !candidate || !selectedLine || busy !== undefined}
          onClick={onPreview}
          type="button"
        >
          {busy === "preview" ? "Preparing preview…" : "Prepare bounded preview"}
        </button>
        {busy === "preview" ? (
          <button onClick={onInterrupt} type="button">
            Stop preview setup
          </button>
        ) : null}
        {preview ? (
          <button
            disabled={!editable || !acknowledged || busy !== undefined}
            onClick={onConfirm}
            type="button"
          >
            {busy === "confirm" ? "Confirming exact candidate…" : "Confirm exact substitution"}
          </button>
        ) : null}
      </div>
      {!editable ? <p className={styles.viewerNote}>Viewer access is inspect-only.</p> : null}
    </section>
  );
}
