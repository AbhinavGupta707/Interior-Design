import type { PlanCandidate, PlanProposal } from "@interior-design/contracts";

import { defaultReview } from "./review-model";
import type {
  CandidateDecision,
  CandidateReview,
  CandidateReviewMap,
  LevelCorrection,
  OpeningCorrection,
  SpaceCorrection,
  WallCorrection,
} from "./review-model";

function candidateName(candidate: PlanCandidate): string {
  if (candidate.kind === "level" || candidate.kind === "space") return candidate.suggestedName;
  if (candidate.kind === "opening") return `${candidate.openingKind} opening`;
  return `Wall ${candidate.candidateId.slice(0, 8)}`;
}

function knowledgeStatus(candidate: PlanCandidate): string {
  return candidate.confidence < 60
    ? "Unknown · below the 60% candidate threshold"
    : "Unverified source-derived proposal";
}

export function CandidateList({
  onSelect,
  proposal,
  reviews,
  selectedCandidateId,
}: {
  readonly onSelect: (candidateId: string) => void;
  readonly proposal: PlanProposal;
  readonly reviews: CandidateReviewMap;
  readonly selectedCandidateId?: string | undefined;
}) {
  return (
    <section className="plan-candidates" aria-labelledby="plan-candidates-title">
      <header>
        <div>
          <h2 id="plan-candidates-title">Candidates</h2>
          <p>Every candidate needs an explicit review decision.</p>
        </div>
        <strong>{proposal.candidates.length}</strong>
      </header>
      <ul>
        {proposal.candidates.map((candidate) => {
          const review = reviews[candidate.candidateId] ?? defaultReview(candidate);
          return (
            <li key={candidate.candidateId}>
              <button
                aria-pressed={candidate.candidateId === selectedCandidateId}
                data-selected={candidate.candidateId === selectedCandidateId}
                onClick={() => {
                  onSelect(candidate.candidateId);
                }}
                type="button"
              >
                <span>
                  <strong>{candidateName(candidate)}</strong>
                  <small>{candidate.kind}</small>
                </span>
                <span>
                  <small>{candidate.confidence}% confidence</small>
                  <em data-decision={review.decision}>{review.decision}</em>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function integer(value: string): number | undefined {
  if (!/^-?\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function IntegerField({
  label,
  max,
  min,
  onChange,
  value,
}: {
  readonly label: string;
  readonly max?: number;
  readonly min?: number;
  readonly onChange: (value: number) => void;
  readonly value: number | undefined;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        inputMode="numeric"
        max={max}
        min={min}
        onChange={(event) => {
          const next = integer(event.target.value);
          if (next !== undefined) onChange(next);
        }}
        required
        step={1}
        type="number"
        value={value ?? ""}
      />
    </label>
  );
}

export function CandidateInspector({
  candidate,
  editable,
  onReview,
  proposal,
  review,
}: {
  readonly candidate?: PlanCandidate | undefined;
  readonly editable: boolean;
  readonly onReview: (review: CandidateReview) => void;
  readonly proposal: PlanProposal;
  readonly review?: CandidateReview | undefined;
}) {
  if (!candidate) {
    return (
      <section className="plan-candidate-inspector">
        <header>
          <h2>Candidate inspector</h2>
          <p>Select a candidate from the list or overlay.</p>
        </header>
      </section>
    );
  }
  const current = review ?? defaultReview(candidate);
  const sourceRegion = candidate.sourceRegion;
  function decide(decision: CandidateDecision): void {
    onReview({ ...current, decision });
  }

  return (
    <section className="plan-candidate-inspector" aria-labelledby="candidate-inspector-title">
      <header>
        <span>{candidate.kind}</span>
        <h2 id="candidate-inspector-title">{candidateName(candidate)}</h2>
        <code>{candidate.candidateId}</code>
      </header>
      <dl className="plan-candidate-metadata">
        <div>
          <dt>Confidence</dt>
          <dd>{candidate.confidence}%</dd>
        </div>
        <div>
          <dt>Knowledge status</dt>
          <dd>{knowledgeStatus(candidate)}</dd>
        </div>
        <div>
          <dt>Source region</dt>
          <dd>
            ({sourceRegion.minimum.x}, {sourceRegion.minimum.y})–({sourceRegion.maximum.x},{" "}
            {sourceRegion.maximum.y})
          </dd>
        </div>
        <div>
          <dt>Decision</dt>
          <dd>{current.decision}</dd>
        </div>
      </dl>
      {editable ? (
        <div className="plan-candidate-decision">
          <fieldset>
            <legend>Review decision</legend>
            {(["accepted", "corrected", "excluded", "unresolved"] as const).map((decision) => (
              <label key={decision}>
                <input
                  checked={current.decision === decision}
                  name={`decision-${candidate.candidateId}`}
                  onChange={() => {
                    decide(decision);
                  }}
                  type="radio"
                />
                {decision}
              </label>
            ))}
          </fieldset>
          {current.decision === "corrected" ? (
            <CorrectionFields
              candidate={candidate}
              onChange={(correction) => {
                onReview({ correction, decision: "corrected" });
              }}
              proposal={proposal}
              review={current}
            />
          ) : null}
          {current.decision === "excluded" ? (
            <p role="note">
              Excluded candidates create no geometry and remain in immutable review metrics.
            </p>
          ) : null}
          {current.decision === "unresolved" ? (
            <p role="note">
              Unresolved candidates create no geometry and block this bounded handoff.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="plan-viewer-note" role="note">
          <strong>Viewer access is read-only</strong>
          <span>
            Candidate decisions, corrections, calibration, drafts, preview and commit are
            unavailable.
          </span>
        </div>
      )}
    </section>
  );
}

function CorrectionFields({
  candidate,
  onChange,
  proposal,
  review,
}: {
  readonly candidate: PlanCandidate;
  readonly onChange: (correction: NonNullable<CandidateReview["correction"]>) => void;
  readonly proposal: PlanProposal;
  readonly review: CandidateReview;
}) {
  if (candidate.kind === "wall") {
    const correction = (review.correction ?? defaultReview(candidate).correction) as WallCorrection;
    return (
      <fieldset className="plan-correction-fields">
        <legend>Exact wall correction</legend>
        <div className="plan-integer-grid">
          <IntegerField
            label="Start X · source integer"
            onChange={(x) => {
              onChange({ ...correction, start: { ...correction.start, x } });
            }}
            value={correction.start.x}
          />
          <IntegerField
            label="Start Y · source integer"
            onChange={(y) => {
              onChange({ ...correction, start: { ...correction.start, y } });
            }}
            value={correction.start.y}
          />
          <IntegerField
            label="End X · source integer"
            onChange={(x) => {
              onChange({ ...correction, end: { ...correction.end, x } });
            }}
            value={correction.end.x}
          />
          <IntegerField
            label="End Y · source integer"
            onChange={(y) => {
              onChange({ ...correction, end: { ...correction.end, y } });
            }}
            value={correction.end.y}
          />
          <IntegerField
            label="Thickness · integer mm"
            min={1}
            onChange={(thicknessMillimetres) => {
              onChange({ ...correction, thicknessMillimetres });
            }}
            value={correction.thicknessMillimetres}
          />
          <IntegerField
            label="Height · integer mm"
            min={1}
            onChange={(heightMillimetres) => {
              onChange({ ...correction, heightMillimetres });
            }}
            value={correction.heightMillimetres}
          />
        </div>
      </fieldset>
    );
  }
  if (candidate.kind === "opening") {
    const correction = (review.correction ??
      defaultReview(candidate).correction) as OpeningCorrection;
    const walls = proposal.candidates.filter((item) => item.kind === "wall");
    return (
      <fieldset className="plan-correction-fields">
        <legend>Exact opening correction</legend>
        <label>
          <span>Host wall candidate</span>
          <select
            onChange={(event) => {
              onChange({ ...correction, hostWallCandidateId: event.target.value });
            }}
            value={correction.hostWallCandidateId}
          >
            {walls.map((wall) => (
              <option key={wall.candidateId} value={wall.candidateId}>
                {wall.candidateId}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Opening kind</span>
          <select
            onChange={(event) => {
              onChange({
                ...correction,
                openingKind: event.target.value as OpeningCorrection["openingKind"],
              });
            }}
            value={correction.openingKind}
          >
            <option value="door">door</option>
            <option value="window">window</option>
            <option value="unknown">unknown</option>
          </select>
        </label>
        <div className="plan-integer-grid">
          <IntegerField
            label="Position along host · integer mm"
            min={1}
            onChange={(offsetAlongHostMillimetres) => {
              onChange({ ...correction, offsetAlongHostMillimetres });
            }}
            value={correction.offsetAlongHostMillimetres}
          />
          <IntegerField
            label="Width · integer mm"
            min={1}
            onChange={(widthMillimetres) => {
              onChange({ ...correction, widthMillimetres });
            }}
            value={correction.widthMillimetres}
          />
          <IntegerField
            label="Height · integer mm"
            min={1}
            onChange={(heightMillimetres) => {
              onChange({ ...correction, heightMillimetres });
            }}
            value={correction.heightMillimetres}
          />
          <IntegerField
            label="Sill · integer mm"
            min={0}
            onChange={(sillHeightMillimetres) => {
              onChange({ ...correction, sillHeightMillimetres });
            }}
            value={correction.sillHeightMillimetres}
          />
        </div>
      </fieldset>
    );
  }
  if (candidate.kind === "space") {
    const correction = (review.correction ??
      defaultReview(candidate).correction) as SpaceCorrection;
    const walls = proposal.candidates.filter((item) => item.kind === "wall");
    return (
      <fieldset className="plan-correction-fields">
        <legend>Exact space correction</legend>
        <label>
          <span>Space name</span>
          <input
            maxLength={160}
            onChange={(event) => {
              onChange({ ...correction, name: event.target.value });
            }}
            required
            value={correction.name}
          />
        </label>
        <fieldset className="plan-boundary-walls">
          <legend>Boundary wall candidates</legend>
          {walls.map((wall) => (
            <label key={wall.candidateId}>
              <input
                checked={correction.boundaryWallCandidateIds.includes(wall.candidateId)}
                onChange={(event) => {
                  onChange({
                    ...correction,
                    boundaryWallCandidateIds: event.target.checked
                      ? [...correction.boundaryWallCandidateIds, wall.candidateId]
                      : correction.boundaryWallCandidateIds.filter((id) => id !== wall.candidateId),
                  });
                }}
                type="checkbox"
              />
              {wall.candidateId}
            </label>
          ))}
        </fieldset>
      </fieldset>
    );
  }
  const correction = (review.correction ?? defaultReview(candidate).correction) as LevelCorrection;
  return (
    <fieldset className="plan-correction-fields">
      <legend>Exact level correction</legend>
      <label>
        <span>Level name</span>
        <input
          maxLength={160}
          onChange={(event) => {
            onChange({ ...correction, name: event.target.value });
          }}
          required
          value={correction.name}
        />
      </label>
      <IntegerField
        label="Elevation · integer mm"
        onChange={(elevationMillimetres) => {
          onChange({ ...correction, elevationMillimetres });
        }}
        value={correction.elevationMillimetres}
      />
    </fieldset>
  );
}
