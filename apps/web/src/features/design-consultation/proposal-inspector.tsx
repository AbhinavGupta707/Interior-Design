import {
  briefEntryCategorySchema,
  briefEntryClassificationSchema,
} from "@interior-design/contracts";
import type {
  BriefEntry,
  BriefEntryClassification,
  BriefPatchOperation,
  BriefPatchProposal,
} from "@interior-design/contracts";

import { ActionButton } from "../../components/ui-primitives";
import styles from "./consultation.module.css";
import { ClassificationBadge } from "./classification-badge";
import { operationLabel, proposalHasExpired, reviewReasonLabel } from "./presentation";

function allowedClassifications(entry: BriefEntry): readonly BriefEntryClassification[] {
  return briefEntryClassificationSchema.options.filter((classification) => {
    if (classification === "observed-evidence") {
      return ["evidence-linked", "system-derived"].includes(entry.provenance.method);
    }
    if (classification === "inferred-suggestion") {
      return ["assistant-suggested", "system-derived"].includes(entry.provenance.method);
    }
    return true;
  });
}

function EntryEditor({
  entry,
  index,
  onChange,
}: {
  readonly entry: BriefEntry;
  readonly index: number;
  readonly onChange: (entry: BriefEntry) => void;
}) {
  return (
    <div className={styles.patchFields}>
      <label>
        Statement
        <textarea
          aria-describedby={"patch-statement-help-" + String(index)}
          maxLength={500}
          onChange={(event) => {
            onChange({ ...entry, statement: event.target.value });
          }}
          required
          rows={3}
          value={entry.statement}
        />
        <span className={styles.fieldHelp} id={"patch-statement-help-" + String(index)}>
          Plain text only · {entry.statement.length} of 500 characters
        </span>
      </label>
      <div className={styles.patchFieldGrid}>
        <label>
          Classification
          <select
            onChange={(event) => {
              onChange({
                ...entry,
                classification: event.target.value as BriefEntryClassification,
              });
            }}
            value={entry.classification}
          >
            {allowedClassifications(entry).map((classification) => (
              <option key={classification} value={classification}>
                {classification.replaceAll("-", " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Category
          <select
            onChange={(event) => {
              onChange({ ...entry, category: event.target.value as BriefEntry["category"] });
            }}
            value={entry.category}
          >
            {briefEntryCategorySchema.options.map((category) => (
              <option key={category} value={category}>
                {category.replaceAll("-", " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select
            onChange={(event) => {
              onChange({ ...entry, priority: Number(event.target.value) });
            }}
            value={entry.priority}
          >
            {[1, 2, 3, 4, 5].map((priority) => (
              <option key={priority} value={priority}>
                {priority} of 5
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className={styles.provenance}>
        Provenance remains fixed: {entry.provenance.method.replaceAll("-", " ")}
        {entry.provenance.sourceMessageId ? ` · message ${entry.provenance.sourceMessageId}` : ""}
      </p>
    </div>
  );
}

function OperationBody({
  index,
  onChange,
  operation,
}: {
  readonly index: number;
  readonly onChange: (operation: BriefPatchOperation) => void;
  readonly operation: BriefPatchOperation;
}) {
  if (operation.kind === "entry.add" || operation.kind === "entry.replace") {
    return (
      <>
        <ClassificationBadge classification={operation.entry.classification} />
        <EntryEditor
          entry={operation.entry}
          index={index}
          onChange={(entry) => {
            onChange({ ...operation, entry });
          }}
        />
      </>
    );
  }
  if (operation.kind === "entry.remove") {
    return (
      <p>
        Entry <code>{operation.entryId}</code> would be removed from the current brief.
      </p>
    );
  }
  if (operation.kind === "reference.add") {
    return (
      <dl className={styles.patchReference}>
        <div>
          <dt>Immutable asset</dt>
          <dd>
            <code>{operation.item.assetId}</code>
          </dd>
        </div>
        <div>
          <dt>Sentiment</dt>
          <dd>{operation.item.sentiment.replaceAll("-", " ")}</dd>
        </div>
        <div>
          <dt>Rights SHA-256</dt>
          <dd>
            <code>{operation.item.rightsRecordSha256}</code>
          </dd>
        </div>
      </dl>
    );
  }
  return (
    <p>
      Reference <code>{operation.itemId}</code> would be removed from the board.
    </p>
  );
}

export function ProposalInspector({
  acknowledged,
  busy,
  currentBriefRevision,
  editable,
  excluded,
  onAcknowledgedChange,
  onConfirm,
  onExcludedChange,
  onOperationsChange,
  operations,
  proposal,
}: {
  readonly acknowledged: boolean;
  readonly busy: boolean;
  readonly currentBriefRevision: number;
  readonly editable: boolean;
  readonly excluded: ReadonlySet<number>;
  readonly onAcknowledgedChange: (value: boolean) => void;
  readonly onConfirm: () => void;
  readonly onExcludedChange: (value: ReadonlySet<number>) => void;
  readonly onOperationsChange: (value: readonly BriefPatchOperation[]) => void;
  readonly operations: readonly BriefPatchOperation[];
  readonly proposal: BriefPatchProposal;
}) {
  const expired = proposalHasExpired(proposal);
  const superseded = proposal.baseBriefRevision !== currentBriefRevision;
  const corrected =
    excluded.size > 0 || JSON.stringify(operations) !== JSON.stringify(proposal.operations);
  const includedCount = operations.length - excluded.size;

  function updateOperation(index: number, operation: BriefPatchOperation): void {
    onOperationsChange(
      operations.map((current, currentIndex) => (currentIndex === index ? operation : current)),
    );
  }

  function toggle(index: number): void {
    const next = new Set(excluded);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    onExcludedChange(next);
  }

  return (
    <section aria-labelledby="proposal-title" className={styles.proposal}>
      <header className={styles.proposalHeader}>
        <div>
          <p className={styles.sectionLabel}>Pending proposal</p>
          <h3 id="proposal-title">Inspect every suggested change</h3>
        </div>
        <span className={styles.proposalStatus} data-expired={expired || superseded}>
          {expired ? "Expired" : superseded ? "Superseded" : proposal.status}
        </span>
      </header>
      <p className={styles.proposalSummary}>{proposal.summary}</p>
      {superseded ? (
        <p className={styles.fieldError} role="note">
          This proposal targets brief revision {proposal.baseBriefRevision} and cannot be applied to
          current revision {currentBriefRevision}. Close the consultation or request a new proposal.
        </p>
      ) : null}

      {proposal.clarifyingQuestions.length > 0 ? (
        <section aria-labelledby="clarifications-title" className={styles.clarifications}>
          <h4 id="clarifications-title">Clarification needed</h4>
          <ol>
            {proposal.clarifyingQuestions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ol>
          <p>Answer in the consultation field. Questions do not change the brief.</p>
        </section>
      ) : null}

      {proposal.professionalReview.length > 0 ? (
        <section aria-labelledby="professional-review-title" className={styles.reviewCallout}>
          <p className={styles.sectionLabel}>Review required</p>
          <h4 id="professional-review-title">Questions the assistant will not answer as fact</h4>
          <ul>
            {proposal.professionalReview.map((item, index) => (
              <li key={item.reason + "-" + String(index)}>
                <strong>{reviewReasonLabel(item.reason)}</strong>
                <span>{item.question}</span>
              </li>
            ))}
          </ul>
          <p>These items remain unresolved until an appropriately accountable reviewer responds.</p>
        </section>
      ) : null}

      {operations.length === 0 ? (
        <div className={styles.emptyState}>
          <h4>No brief patch proposed</h4>
          <p>Respond to the clarification or arrange the named review. The brief is unchanged.</p>
        </div>
      ) : (
        <ol className={styles.patchList}>
          {operations.map((operation, index) => (
            <li data-excluded={excluded.has(index)} key={operation.kind + "-" + String(index)}>
              <div className={styles.patchHeading}>
                <label>
                  <input
                    checked={!excluded.has(index)}
                    disabled={!editable || expired || superseded || busy}
                    onChange={() => {
                      toggle(index);
                    }}
                    type="checkbox"
                  />
                  Include change {index + 1}: {operationLabel(operation)}
                </label>
              </div>
              <fieldset
                disabled={!editable || expired || superseded || busy || excluded.has(index)}
              >
                <legend className={styles.visuallyHidden}>{operationLabel(operation)}</legend>
                <OperationBody
                  index={index}
                  onChange={(next) => {
                    updateOperation(index, next);
                  }}
                  operation={operation}
                />
              </fieldset>
            </li>
          ))}
        </ol>
      )}

      <div className={styles.manifest}>
        <div>
          <span>Adapter</span>
          <strong>{proposal.providerManifest.adapter}</strong>
        </div>
        <div>
          <span>External network</span>
          <strong>Not used</strong>
        </div>
        <div>
          <span>Expires</span>
          <strong>{new Date(proposal.expiresAt).toLocaleString("en-GB")}</strong>
        </div>
      </div>

      {operations.length > 0 ? (
        <div className={styles.confirmation}>
          <label>
            <input
              checked={acknowledged}
              disabled={!editable || expired || superseded || busy || includedCount === 0}
              onChange={(event) => {
                onAcknowledgedChange(event.target.checked);
              }}
              type="checkbox"
            />
            I reviewed the included changes and understand this updates only the C11 design brief.
          </label>
          <p>
            {corrected
              ? "Your selected draft will be applied as a revision-checked, user-stated correction attributed to you. Inferred suggestions become preferences and observed-evidence labels become household assertions because the original assistant proposal will not be confirmed."
              : "The exact pending proposal will be revalidated against the latest brief revision before confirmation."}
          </p>
          <ActionButton
            disabled={
              !editable || expired || superseded || busy || !acknowledged || includedCount === 0
            }
            onClick={onConfirm}
            tone="primary"
          >
            {busy
              ? "Applying…"
              : corrected
                ? "Apply corrected brief patch"
                : "Confirm exact proposal"}
          </ActionButton>
          {!editable ? (
            <p className={styles.readOnlyCopy}>
              Viewer access is read-only; confirmation is unavailable.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
