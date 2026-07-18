import type {
  DesignOption,
  DesignOptionSet,
  OptionConfirmation,
  OptionJob,
} from "@interior-design/contracts";

import { ActionButton, ActionLink } from "../../components/ui-primitives";
import {
  basisPointsLabel,
  millimetresLabel,
  optionDirectionLabels,
  semanticOptionDifference,
  shortHash,
} from "./presentation";
import styles from "./design-options.module.css";

function formattedTime(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function operationTarget(option: DesignOption, index: number): string {
  const operation = option.operationBundle.operations[index];
  if (!operation) return "Unavailable";
  if (operation.type === "design.element.remove.v1") {
    return `${operation.target.collection} · ${operation.target.elementId}`;
  }
  if (
    operation.type === "design.element.create.v1" ||
    operation.type === "design.element.replace.v1"
  ) {
    return `${operation.element.elementType} · ${operation.element.id}`;
  }
  return operation.type;
}

function DetailList({
  empty,
  items,
  title,
}: {
  readonly empty: string;
  readonly items: readonly string[];
  readonly title: string;
}) {
  return (
    <section className={styles.detailSection}>
      <h4>{title}</h4>
      {items.length === 0 ? (
        <p>{empty}</p>
      ) : (
        <ul>
          {items.map((item, index) => (
            <li key={`${title}-${String(index)}`}>{item}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OptionColumn({
  acknowledged,
  busy,
  confirmation,
  editable,
  job,
  onAcknowledgedChange,
  onConfirm,
  option,
  optionSet,
}: {
  readonly acknowledged: boolean;
  readonly busy: boolean;
  readonly confirmation?: OptionConfirmation;
  readonly editable: boolean;
  readonly job: OptionJob;
  readonly onAcknowledgedChange: (checked: boolean) => void;
  readonly onConfirm: () => void;
  readonly option: DesignOption;
  readonly optionSet: DesignOptionSet;
}) {
  const expired = option.status === "expired" || Date.parse(option.expiresAt) <= Date.now();
  const hardResults = option.operationBundle.constraintResults.filter(
    ({ strength }) => strength === "hard",
  );
  const objectiveResults = option.operationBundle.constraintResults.filter(
    ({ strength }) => strength === "objective",
  );
  return (
    <article className={styles.optionColumn} data-option-status={option.status}>
      <header className={styles.optionHeader}>
        <div>
          <p>{optionDirectionLabels[option.direction]}</p>
          <h3>{option.title}</h3>
        </div>
        <strong>{option.status}</strong>
      </header>
      <p className={styles.optionSummary}>{option.summary}</p>
      <dl className={styles.optionMeta}>
        <div>
          <dt>Expires</dt>
          <dd>{formattedTime(option.expiresAt)}</dd>
        </div>
        <div>
          <dt>Candidate snapshot</dt>
          <dd>
            <code title={option.operationBundle.candidateSnapshotSha256}>
              {shortHash(option.operationBundle.candidateSnapshotSha256)}
            </code>
          </dd>
        </div>
        <div>
          <dt>Bundle</dt>
          <dd>
            <code title={option.operationBundle.bundleSha256}>
              {shortHash(option.operationBundle.bundleSha256)}
            </code>
          </dd>
        </div>
        <div>
          <dt>Local engine</dt>
          <dd>
            {option.providerManifest.engineVersion} · seed {option.providerManifest.seed}
          </dd>
        </div>
      </dl>

      <section className={styles.validityScope} aria-label="Computational validity scope">
        <strong>Computationally valid within the frozen scope</strong>
        <p>
          All {hardResults.length} retained hard constraints passed exact integer checks. This is
          not structural, regulatory, accessibility-clinical, cost, availability, or professional
          approval.
        </p>
      </section>

      <section className={styles.detailSection}>
        <h4>Objective trade-offs</h4>
        <ul className={styles.objectiveList}>
          {option.objectives.map((objective) => (
            <li key={objective.id}>
              <div>
                <strong>{objective.id.replaceAll("-", " ")}</strong>
                <span>{basisPointsLabel(objective.basisPoints)}</span>
              </div>
              <meter max={10_000} min={0} value={objective.basisPoints}>
                {basisPointsLabel(objective.basisPoints)}
              </meter>
              <p>{objective.rationale}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.detailSection}>
        <h4>Constraint evidence</h4>
        <ul className={styles.constraintList}>
          {[...hardResults, ...objectiveResults].map((result) => (
            <li key={result.constraintId}>
              <span data-pass={String(result.passed)}>{result.passed ? "Passed" : "Not met"}</span>
              <p>{result.detail}</p>
              {result.measuredValue !== undefined ? (
                <small>
                  Measured {millimetresLabel(result.measuredValue)}
                  {result.thresholdValue === undefined
                    ? ""
                    : ` · threshold ${millimetresLabel(result.thresholdValue)}`}
                </small>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <DetailList
        empty="No assumptions were retained."
        items={option.assumptions}
        title="Assumptions"
      />
      <DetailList empty="No unknowns were retained." items={option.unknowns} title="Unknowns" />
      <DetailList
        empty="No narrative trade-offs were retained."
        items={option.tradeoffs}
        title="Trade-offs"
      />

      <section className={styles.detailSection}>
        <h4>Review routes</h4>
        {option.professionalReview.length === 0 ? (
          <p>No professional review question was retained for this option.</p>
        ) : (
          <ul>
            {option.professionalReview.map((review, index) => (
              <li key={`${review.reason}-${String(index)}`}>
                <strong>{review.reason.replaceAll("-", " ")}</strong> · {review.question}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.detailSection}>
        <h4>Real asset and assignment differences</h4>
        <div className={styles.tableScroll} tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>Asset</th>
                <th>Material</th>
                <th>Envelope (mm)</th>
                <th>Assignment</th>
              </tr>
            </thead>
            <tbody>
              {option.operationBundle.assetPlacements.map(({ asset, elementId, spaceId }) => (
                <tr key={elementId}>
                  <td>
                    {asset.category} · {asset.kind}
                    <small>{asset.version}</small>
                  </td>
                  <td>{asset.materialLabel}</td>
                  <td>
                    {asset.geometryEnvelopeMm.widthMm} × {asset.geometryEnvelopeMm.depthMm} ×{" "}
                    {asset.geometryEnvelopeMm.heightMm}
                  </td>
                  <td>
                    <code>{spaceId ?? "unassigned"}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.detailSection}>
        <h4>Typed proposed operations</h4>
        <ol className={styles.operationList}>
          {option.operationBundle.operations.map((operation, index) => (
            <li key={operation.clientOperationId}>
              <strong>{operation.type}</strong>
              <span>
                {operation.schemaVersion} · {operationTarget(option, index)}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <footer className={styles.confirmationPanel}>
        {confirmation ? (
          <div className={styles.confirmedResult} role="status">
            <strong>Confirmed into an isolated proposed branch</strong>
            <dl>
              <div>
                <dt>Branch / revision</dt>
                <dd>
                  <code>{confirmation.branchId}</code> / {confirmation.branchRevision}
                </dd>
              </div>
              <div>
                <dt>Commit</dt>
                <dd>
                  <code>{confirmation.commitId}</code>
                </dd>
              </div>
              <div>
                <dt>Result hash</dt>
                <dd>
                  <code>{confirmation.resultSnapshotSha256}</code>
                </dd>
              </div>
            </dl>
            <ActionLink
              href={`/materials-products/${encodeURIComponent(confirmation.projectId)}?${new URLSearchParams({ confirmationId: confirmation.id }).toString()}`}
            >
              Build the room specification
            </ActionLink>
          </div>
        ) : (
          <>
            <label>
              <input
                checked={acknowledged}
                disabled={!editable || option.status !== "pending" || expired || busy}
                onChange={(event) => {
                  onAcknowledgedChange(event.target.checked);
                }}
                type="checkbox"
              />
              <span>
                I reviewed this option’s exact pins, constraints, assumptions, unknowns, trade-offs,
                assets, and review routes. Create a separate proposed branch.
              </span>
            </label>
            <ActionButton
              disabled={
                !editable || !acknowledged || option.status !== "pending" || expired || busy
              }
              onClick={onConfirm}
            >
              {busy ? "Confirming atomically…" : "Confirm this option"}
            </ActionButton>
            <p>
              Confirmation is the only mutation boundary. It revalidates job version {job.version},
              set <code>{shortHash(optionSet.setSha256)}</code>, brief, source snapshot, assets, and
              candidate hash before committing.
            </p>
            {!editable ? <strong>Viewer access is read-only.</strong> : null}
            {expired ? <strong>This proposal has expired; no branch can be created.</strong> : null}
          </>
        )}
      </footer>
    </article>
  );
}

export function OptionComparison({
  acknowledgements,
  busyOptionId,
  confirmations,
  editable,
  job,
  leftOptionId,
  onAcknowledgedChange,
  onConfirm,
  onSelectionChange,
  optionSet,
  options,
  rightOptionId,
}: {
  readonly acknowledgements: Readonly<Record<string, boolean>>;
  readonly busyOptionId?: string;
  readonly confirmations: Readonly<Record<string, OptionConfirmation>>;
  readonly editable: boolean;
  readonly job: OptionJob;
  readonly leftOptionId: string;
  readonly onAcknowledgedChange: (optionId: string, checked: boolean) => void;
  readonly onConfirm: (option: DesignOption) => void;
  readonly onSelectionChange: (side: "left" | "right", optionId: string) => void;
  readonly optionSet: DesignOptionSet;
  readonly options: readonly DesignOption[];
  readonly rightOptionId: string;
}) {
  const left = options.find(({ id }) => id === leftOptionId);
  const right = options.find(({ id }) => id === rightOptionId);
  if (!left || !right || left.id === right.id) {
    return (
      <section className={styles.emptyBody}>
        <h2>Choose two different options</h2>
        <p>A comparison requires two validated options from the same complete option set.</p>
      </section>
    );
  }
  const difference = semanticOptionDifference(left, right);
  const matrix = optionSet.pairwiseDiversity.find(
    ({ leftOptionId: matrixLeft, rightOptionId: matrixRight }) =>
      (matrixLeft === left.id && matrixRight === right.id) ||
      (matrixLeft === right.id && matrixRight === left.id),
  );
  return (
    <section aria-labelledby="comparison-title" className={styles.comparison}>
      <header className={styles.comparisonHeader}>
        <div>
          <p className={styles.sectionLabel}>Independent comparison</p>
          <h2 id="comparison-title">Compare operations, not just narratives</h2>
        </div>
        <code title={optionSet.setSha256}>{shortHash(optionSet.setSha256)}</code>
      </header>
      <div className={styles.comparisonSelectors}>
        <label>
          Option A
          <select
            onChange={(event) => {
              onSelectionChange("left", event.target.value);
            }}
            value={left.id}
          >
            {options.map((option) => (
              <option disabled={option.id === right.id} key={option.id} value={option.id}>
                {option.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Option B
          <select
            onChange={(event) => {
              onSelectionChange("right", event.target.value);
            }}
            value={right.id}
          >
            {options.map((option) => (
              <option disabled={option.id === left.id} key={option.id} value={option.id}>
                {option.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.differenceRail} role="status">
        {(
          [
            ["Asset inventory", difference.assetInventory],
            ["Assignment", difference.assignment],
            ["Placement", difference.placement],
            ["Material", difference.material],
            ["Operation signature", difference.operationSignature],
          ] as const
        ).map(([label, changed]) => (
          <span data-changed={String(changed)} key={label}>
            {label}: {changed ? "different" : "same"}
          </span>
        ))}
      </div>
      {difference.genuinelyDifferent && matrix ? (
        <dl className={styles.matrixGrid}>
          <div>
            <dt>Asset distance</dt>
            <dd>{basisPointsLabel(matrix.assetInventoryDistanceBasisPoints)}</dd>
          </div>
          <div>
            <dt>Assignment distance</dt>
            <dd>{basisPointsLabel(matrix.assignmentDistanceBasisPoints)}</dd>
          </div>
          <div>
            <dt>Placement distance</dt>
            <dd>{millimetresLabel(matrix.placementDistanceMm)}</dd>
          </div>
          <div>
            <dt>Material distance</dt>
            <dd>{basisPointsLabel(matrix.materialDistanceBasisPoints)}</dd>
          </div>
          <div>
            <dt>Operation distance</dt>
            <dd>{basisPointsLabel(matrix.operationSignatureDistanceBasisPoints)}</dd>
          </div>
        </dl>
      ) : (
        <div className={styles.invalidDifference} role="alert">
          Narrative-only or incomplete diversity was detected. Confirmation is unavailable until the
          option set is regenerated and validated.
        </div>
      )}
      <div className={styles.optionGrid}>
        {[left, right].map((option) => (
          <OptionColumn
            acknowledged={acknowledgements[option.id] ?? false}
            busy={busyOptionId === option.id}
            {...(confirmations[option.id] ? { confirmation: confirmations[option.id] } : {})}
            editable={editable && difference.genuinelyDifferent && matrix !== undefined}
            job={job}
            key={option.id}
            onAcknowledgedChange={(checked) => {
              onAcknowledgedChange(option.id, checked);
            }}
            onConfirm={() => {
              onConfirm(option);
            }}
            option={option}
            optionSet={optionSet}
          />
        ))}
      </div>
    </section>
  );
}
