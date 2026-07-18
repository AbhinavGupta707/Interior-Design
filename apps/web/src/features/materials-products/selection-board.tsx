import type { Specification, SpecificationLine } from "@interior-design/contracts";
import { useEffect, useState } from "react";

import styles from "./materials-products.module.css";
import { lineQuantity, roomLabel } from "./presentation";

function boardEntry(
  specification: Specification,
  line: SpecificationLine,
): Specification["selectionBoard"]["entries"][number] {
  return (
    specification.selectionBoard.entries.find(
      (entry) => entry.elementId === line.elementId && entry.assetVersionId === line.assetVersionId,
    ) ?? {
      assetVersionId: line.assetVersionId,
      elementId: line.elementId,
      note: line.notes,
      state: line.decisionStatus,
    }
  );
}

export function SelectionBoard({
  busy,
  editable,
  onSave,
  onSelectLine,
  selectedLineId,
  specification,
}: {
  readonly busy: boolean;
  readonly editable: boolean;
  readonly onSave: (
    entries: Specification["selectionBoard"]["entries"],
    announcement: string,
  ) => void;
  readonly onSelectLine: (lineId: string) => void;
  readonly selectedLineId?: string;
  readonly specification: Specification;
}) {
  const selectedLine = specification.currentRevision.lines.find(
    ({ lineId }) => lineId === selectedLineId,
  );
  const [note, setNote] = useState("");

  useEffect(() => {
    setNote(selectedLine ? boardEntry(specification, selectedLine).note : "");
  }, [selectedLine, specification]);

  function saveEntry(state: "needs-review" | "rejected" | "selected" | "shortlisted"): void {
    if (!selectedLine) return;
    const next = specification.currentRevision.lines.map((line) => {
      const current = boardEntry(specification, line);
      return line.lineId === selectedLine.lineId ? { ...current, note, state } : current;
    });
    onSave(next, `${selectedLine.kind} marked ${state.replace("-", " ")}.`);
  }

  return (
    <section aria-labelledby="board-title" className={styles.boardPanel}>
      <header className={styles.sectionHeader}>
        <div>
          <p className={styles.sectionLabel}>Working revision</p>
          <h2 id="board-title">Selection board</h2>
        </div>
        <p>
          Revision {specification.currentRevision.revision} · {specification.status}
        </p>
      </header>
      <div className={styles.boardLayout}>
        <ol aria-label="Specification lines" className={styles.lineList}>
          {specification.currentRevision.lines.map((line, index) => {
            const entry = boardEntry(specification, line);
            return (
              <li key={line.lineId}>
                <button
                  aria-current={selectedLineId === line.lineId ? "true" : undefined}
                  data-line-id={line.lineId}
                  data-selected={String(selectedLineId === line.lineId)}
                  onClick={() => {
                    onSelectLine(line.lineId);
                  }}
                  type="button"
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <span>
                    <strong>{line.kind}</strong>
                    <small>{roomLabel(line)}</small>
                  </span>
                  <em data-state={entry.state}>{entry.state.replace("-", " ")}</em>
                </button>
              </li>
            );
          })}
        </ol>
        {selectedLine ? (
          <div className={styles.lineInspector}>
            <div className={styles.inspectorHeading}>
              <div>
                <p className={styles.sectionLabel}>Exact element</p>
                <h3>{selectedLine.kind} selection</h3>
              </div>
              <code>{selectedLine.elementId}</code>
            </div>
            <dl className={styles.lineFacts}>
              <div>
                <dt>Room assignment</dt>
                <dd>{roomLabel(selectedLine)}</dd>
              </div>
              <div>
                <dt>Quantity</dt>
                <dd>{lineQuantity(selectedLine)}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{selectedLine.selectionSource.kind.replaceAll("-", " ")}</dd>
              </div>
            </dl>
            <p className={styles.roomBoundary}>
              Room assignment is shown from the exact immutable line. The frozen C13 board request
              permits decision and note edits only; ambiguous rooms remain review-required rather
              than being guessed in the browser.
            </p>
            <label className={styles.noteField}>
              <span>Decision note</span>
              <textarea
                disabled={!editable || busy}
                maxLength={1_000}
                onChange={(event) => {
                  setNote(event.currentTarget.value);
                }}
                rows={4}
                value={note}
              />
              <small>{note.length}/1,000 · saved only to an immutable server revision</small>
            </label>
            <div aria-label="Decision actions" className={styles.decisionActions}>
              <button
                disabled={!editable || busy}
                onClick={() => {
                  saveEntry("selected");
                }}
                type="button"
              >
                Keep selected
              </button>
              <button
                disabled={!editable || busy}
                onClick={() => {
                  saveEntry("shortlisted");
                }}
                type="button"
              >
                Shortlist
              </button>
              <button
                disabled={!editable || busy}
                onClick={() => {
                  saveEntry("needs-review");
                }}
                type="button"
              >
                Needs review
              </button>
              <button
                disabled={!editable || busy}
                onClick={() => {
                  saveEntry("rejected");
                }}
                type="button"
              >
                Reject
              </button>
            </div>
            {!editable ? <p className={styles.viewerNote}>Viewer access is inspect-only.</p> : null}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <h3>Select a specification line</h3>
            <p>Use the numbered controls; dragging is never required.</p>
          </div>
        )}
      </div>
    </section>
  );
}
