import type { DesignOption } from "@interior-design/contracts";
import { useEffect, useState } from "react";
import type { SyntheticEvent } from "react";

import { ActionButton } from "../../components/ui-primitives";
import type { DesignOptionLaunchContext } from "./contracts";
import { optionDirectionLabels, shortHash } from "./presentation";
import styles from "./design-options.module.css";

type OptionDirection = DesignOption["direction"];

const directions = Object.keys(optionDirectionLabels) as OptionDirection[];

export function GenerationPanel({
  busy,
  editable,
  onGenerate,
  projectId,
  source,
}: {
  readonly busy: boolean;
  readonly editable: boolean;
  readonly onGenerate: (request: DesignOptionLaunchContext) => Promise<void>;
  readonly projectId: string;
  readonly source?: DesignOptionLaunchContext;
}) {
  const [selectedDirections, setSelectedDirections] = useState<readonly OptionDirection[]>(
    source?.requestedDirections ?? ["circulation-first", "conversation-first"],
  );
  const [optionCount, setOptionCount] = useState(source?.requestedOptionCount ?? 2);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!source) return;
    setSelectedDirections(source.requestedDirections);
    setOptionCount(source.requestedOptionCount);
  }, [source]);

  async function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>): Promise<void> {
    event.preventDefault();
    if (!source || !editable || busy) return;
    if (selectedDirections.length < 2) {
      setError("Choose at least two genuinely different design directions.");
      return;
    }
    setError(undefined);
    await onGenerate({
      ...source,
      requestedDirections: [...selectedDirections],
      requestedOptionCount: optionCount,
    });
  }

  function toggleDirection(direction: OptionDirection): void {
    setSelectedDirections((current) =>
      current.includes(direction)
        ? current.filter((candidate) => candidate !== direction)
        : [...current, direction],
    );
  }

  return (
    <section aria-labelledby="generation-title" className={styles.panel}>
      <header className={styles.panelHeader}>
        <div>
          <p className={styles.sectionLabel}>Pinned generation</p>
          <h2 id="generation-title">Create a bounded option set</h2>
        </div>
        <span>{editable ? "Owner/editor action" : "Viewer read-only"}</span>
      </header>
      {source ? (
        <>
          <dl className={styles.pinGrid}>
            <div>
              <dt>Accepted brief</dt>
              <dd>
                Revision {source.baseBrief.revision} · <code>{source.baseBrief.briefId}</code>
              </dd>
            </div>
            <div>
              <dt>Brief content hash</dt>
              <dd>
                <code title={source.baseBrief.contentSha256}>
                  {shortHash(source.baseBrief.contentSha256)}
                </code>
              </dd>
            </div>
            <div>
              <dt>Canonical source</dt>
              <dd>
                {source.sourceModel.profile} · version {source.sourceModel.snapshotVersion}
              </dd>
            </div>
            <div>
              <dt>Snapshot hash</dt>
              <dd>
                <code title={source.sourceModel.snapshotSha256}>
                  {shortHash(source.sourceModel.snapshotSha256)}
                </code>
              </dd>
            </div>
          </dl>
          <form
            className={styles.generationForm}
            onSubmit={(event) => {
              void submit(event);
            }}
          >
            <fieldset disabled={!editable || busy}>
              <legend>Design directions</legend>
              <p>
                Choose two to five priorities. These are inputs, not claims that constraints pass.
              </p>
              <div className={styles.directionChoices}>
                {directions.map((direction) => (
                  <label key={direction}>
                    <input
                      checked={selectedDirections.includes(direction)}
                      onChange={() => {
                        toggleDirection(direction);
                      }}
                      type="checkbox"
                    />
                    <span>{optionDirectionLabels[direction]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className={styles.countField}>
              Options requested
              <select
                disabled={!editable || busy}
                onChange={(event) => {
                  setOptionCount(Number(event.target.value));
                }}
                value={optionCount}
              >
                {[2, 3, 4, 5, 6, 7, 8].map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </label>
            {error ? (
              <p className={styles.fieldError} role="alert">
                {error}
              </p>
            ) : null}
            <div className={styles.generationAction}>
              <ActionButton
                disabled={
                  !editable ||
                  busy ||
                  selectedDirections.length < 2 ||
                  selectedDirections.length > 5
                }
                type="submit"
              >
                {busy ? "Starting bounded generation…" : "Generate inspectable options"}
              </ActionButton>
              <p>
                The server derives and validates hard constraints. Generation cannot mutate the
                existing, proposed, or as-built canonical profiles.
              </p>
            </div>
          </form>
        </>
      ) : (
        <div className={styles.emptyBody}>
          <h3>No accepted brief/model hand-off is available</h3>
          <p>
            Open this workspace from an accepted brief and exact committed model, or select a prior
            job below. This page will not guess a brief hash or canonical snapshot.
          </p>
          <div className={styles.inlineLinks}>
            <a href={`/design-consultation/${projectId}`}>Review the accepted brief</a>
            <a href={`/editor/${projectId}`}>Review canonical models</a>
          </div>
        </div>
      )}
    </section>
  );
}
