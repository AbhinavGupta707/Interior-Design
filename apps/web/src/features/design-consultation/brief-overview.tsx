import type { BriefEntry, DesignBrief } from "@interior-design/contracts";

import styles from "./consultation.module.css";
import { ClassificationBadge } from "./classification-badge";
import { categoryLabel, classificationFor, entryCounts } from "./presentation";

const classificationOrder = [
  "hard-constraint",
  "observed-evidence",
  "household-assertion",
  "preference",
  "inferred-suggestion",
  "unresolved-conflict",
  "unknown",
] as const;

function provenanceLabel(entry: BriefEntry): string {
  const method = entry.provenance.method.replaceAll("-", " ");
  if (entry.provenance.assetId) return `${method} · immutable asset ${entry.provenance.assetId}`;
  if (entry.provenance.sourceMessageId)
    return `${method} · source message ${entry.provenance.sourceMessageId}`;
  if (entry.provenance.sourceSnapshotId)
    return `${method} · snapshot ${entry.provenance.sourceSnapshotId}`;
  if (entry.provenance.statedByUserId) return `${method} · user ${entry.provenance.statedByUserId}`;
  return method;
}

export function BriefOverview({ brief }: { readonly brief: DesignBrief }) {
  const counts = entryCounts(brief);
  return (
    <section aria-labelledby="brief-overview-title" className={styles.panel}>
      <header className={styles.panelHeader}>
        <div>
          <p className={styles.sectionLabel}>Structured brief</p>
          <h2 id="brief-overview-title">What the design must respond to</h2>
        </div>
        <p className={styles.revision}>
          Revision {brief.revision} · {brief.status}
        </p>
      </header>

      <div aria-label="Brief classification summary" className={styles.classificationSummary}>
        {classificationOrder.map((classification) => {
          const presentation = classificationFor(classification);
          return (
            <div data-tone={presentation.tone} key={classification}>
              <strong>{counts[classification]}</strong>
              <span>{presentation.label}</span>
            </div>
          );
        })}
      </div>

      {brief.entries.length === 0 ? (
        <div className={styles.emptyState}>
          <h3>No brief entries yet</h3>
          <p>
            Start a consultation to turn household needs into inspectable entries. Nothing is
            inferred from an empty brief.
          </p>
        </div>
      ) : (
        <ol className={styles.entryList}>
          {brief.entries.map((entry) => (
            <li className={styles.entry} data-status={entry.status} key={entry.id}>
              <div className={styles.entryMeta}>
                <ClassificationBadge classification={entry.classification} />
                <span>{categoryLabel(entry.category)}</span>
                <span>Priority {entry.priority} of 5</span>
                {entry.status !== "active" ? <span>{entry.status}</span> : null}
              </div>
              <p className={styles.entryStatement}>{entry.statement}</p>
              <p className={styles.provenance}>{provenanceLabel(entry)}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
