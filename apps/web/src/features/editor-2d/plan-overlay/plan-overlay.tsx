"use client";

import type { PlanCandidate, PlanProposal, PlanSourcePoint } from "@interior-design/contracts";
import { useMemo, useState } from "react";

export interface PlanOverlayProps {
  readonly calibrationPick?: "end" | "start" | undefined;
  readonly onCalibrationPoint?: (kind: "end" | "start", point: PlanSourcePoint) => void;
  readonly onSelect: (candidateId: string) => void;
  readonly proposal: PlanProposal;
  readonly selectedCandidateId?: string | undefined;
  readonly sourcePreviewUrl?: string | undefined;
}

const zoomSteps = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;

function candidateLabel(candidate: PlanCandidate): string {
  if (candidate.kind === "level" || candidate.kind === "space") return candidate.suggestedName;
  if (candidate.kind === "opening") return `${candidate.openingKind} opening`;
  return "wall";
}

export function PlanOverlay({
  calibrationPick,
  onCalibrationPoint,
  onSelect,
  proposal,
  selectedCandidateId,
  sourcePreviewUrl,
}: PlanOverlayProps) {
  const [sourceVisible, setSourceVisible] = useState(true);
  const [proposalVisible, setProposalVisible] = useState(true);
  const [sourceOpacity, setSourceOpacity] = useState(70);
  const [zoomIndex, setZoomIndex] = useState(2);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const source = proposal.source;
  const zoom = zoomSteps[zoomIndex] ?? 1;
  const walls = useMemo(
    () =>
      new Map(
        proposal.candidates
          .filter((candidate) => candidate.kind === "wall")
          .map((wall) => [wall.candidateId, wall]),
      ),
    [proposal.candidates],
  );

  function select(candidateId: string): void {
    onSelect(candidateId);
  }

  return (
    <section className="plan-overlay" aria-labelledby="plan-overlay-title">
      <header className="plan-overlay__header">
        <div>
          <h2 id="plan-overlay-title">Source and proposal overlay</h2>
          <p>Safe derived preview and schema-validated vector primitives only.</p>
        </div>
        <div className="plan-overlay__tools" aria-label="Overlay view controls">
          <button
            aria-label="Zoom out"
            disabled={zoomIndex === 0}
            onClick={() => { setZoomIndex((current) => Math.max(0, current - 1)); }}
            type="button"
          >
            Zoom −
          </button>
          <output aria-label="Current zoom">{Math.round(zoom * 100)}%</output>
          <button
            aria-label="Zoom in"
            disabled={zoomIndex === zoomSteps.length - 1}
            onClick={() => { setZoomIndex((current) => Math.min(zoomSteps.length - 1, current + 1)); }}
            type="button"
          >
            Zoom +
          </button>
          <button
            onClick={() => { setPan((current) => ({ ...current, x: current.x + 250 })); }}
            type="button"
          >
            Pan left
          </button>
          <button
            onClick={() => { setPan((current) => ({ ...current, x: current.x - 250 })); }}
            type="button"
          >
            Pan right
          </button>
          <button
            onClick={() => { setPan((current) => ({ ...current, y: current.y + 250 })); }}
            type="button"
          >
            Pan up
          </button>
          <button
            onClick={() => { setPan((current) => ({ ...current, y: current.y - 250 })); }}
            type="button"
          >
            Pan down
          </button>
          <button
            onClick={() => {
              setPan({ x: 0, y: 0 });
              setZoomIndex(2);
            }}
            type="button"
          >
            Reset view
          </button>
        </div>
      </header>
      <div className="plan-overlay__layers">
        <label>
          <input
            checked={sourceVisible}
            onChange={(event) => { setSourceVisible(event.target.checked); }}
            type="checkbox"
          />
          Derived source
        </label>
        <label>
          <input
            checked={proposalVisible}
            onChange={(event) => { setProposalVisible(event.target.checked); }}
            type="checkbox"
          />
          Proposal
        </label>
        <label className="plan-overlay__opacity">
          <span>Source opacity</span>
          <input
            aria-label="Source opacity"
            max={100}
            min={0}
            onChange={(event) => { setSourceOpacity(Number(event.target.value)); }}
            type="range"
            value={sourceOpacity}
          />
          <output>{sourceOpacity}%</output>
        </label>
      </div>
      {calibrationPick ? (
        <p className="plan-overlay__pick" role="status">
          Select the calibration {calibrationPick} point on the overlay, or enter exact coordinates
          in the form.
        </p>
      ) : null}
      <div className="plan-overlay__surface">
        <svg
          aria-label="Floor-plan source and proposal overlay"
          className="plan-overlay__svg"
          onPointerDown={(event) => {
            if (!calibrationPick || !onCalibrationPoint) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const rawX = ((event.clientX - bounds.left) / bounds.width) * source.widthSourceUnits;
            const rawY = ((event.clientY - bounds.top) / bounds.height) * source.heightSourceUnits;
            onCalibrationPoint(calibrationPick, {
              x: Math.round((rawX - pan.x) / zoom),
              y: Math.round((rawY - pan.y) / zoom),
            });
          }}
          role="img"
          viewBox={`0 0 ${String(source.widthSourceUnits)} ${String(source.heightSourceUnits)}`}
        >
          <title>Derived source and C6 proposal for page {source.pageIndex + 1}</title>
          <defs>
            <pattern height="500" id="plan-source-grid" patternUnits="userSpaceOnUse" width="500">
              <path className="plan-overlay__grid" d="M 500 0 L 0 0 0 500" fill="none" />
            </pattern>
          </defs>
          <g transform={`translate(${String(pan.x)} ${String(pan.y)}) scale(${String(zoom)})`}>
            {sourceVisible ? (
              <g opacity={sourceOpacity / 100}>
                <rect
                  className="plan-overlay__source-fallback"
                  height={source.heightSourceUnits}
                  width={source.widthSourceUnits}
                  x={0}
                  y={0}
                />
                <rect
                  fill="url(#plan-source-grid)"
                  height={source.heightSourceUnits}
                  width={source.widthSourceUnits}
                  x={0}
                  y={0}
                />
                {sourcePreviewUrl ? (
                  <image
                    height={source.heightSourceUnits}
                    href={sourcePreviewUrl}
                    preserveAspectRatio="xMidYMid meet"
                    width={source.widthSourceUnits}
                    x={0}
                    y={0}
                  />
                ) : null}
              </g>
            ) : null}
            {proposalVisible ? (
              <g>
                {proposal.candidates.map((candidate) => {
                  if (candidate.kind === "level") return null;
                  const selected = candidate.candidateId === selectedCandidateId;
                  if (candidate.kind === "space") {
                    const points = candidate.boundaryWallCandidateIds.flatMap((id) => {
                      const wall = walls.get(id);
                      return wall ? [`${String(wall.start.x)},${String(wall.start.y)}`] : [];
                    });
                    return points.length >= 3 ? (
                      <g
                        aria-label={`${candidateLabel(candidate)}, confidence ${String(candidate.confidence)} percent`}
                        data-selected={selected}
                        key={candidate.candidateId}
                        onClick={() => { select(candidate.candidateId); }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ")
                            select(candidate.candidateId);
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <polygon className="plan-overlay__space" points={points.join(" ")} />
                      </g>
                    ) : null;
                  }
                  return (
                    <g
                      aria-label={`${candidateLabel(candidate)}, confidence ${String(candidate.confidence)} percent`}
                      data-selected={selected}
                      key={candidate.candidateId}
                      onClick={() => { select(candidate.candidateId); }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ")
                          select(candidate.candidateId);
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <line
                        className={
                          candidate.kind === "opening"
                            ? "plan-overlay__opening"
                            : "plan-overlay__wall"
                        }
                        x1={candidate.start.x}
                        x2={candidate.end.x}
                        y1={candidate.start.y}
                        y2={candidate.end.y}
                      />
                    </g>
                  );
                })}
                {selectedCandidateId
                  ? (() => {
                      const selected = proposal.candidates.find(
                        ({ candidateId }) => candidateId === selectedCandidateId,
                      );
                      return selected ? (
                        <rect
                          className="plan-overlay__source-region"
                          height={selected.sourceRegion.maximum.y - selected.sourceRegion.minimum.y}
                          width={selected.sourceRegion.maximum.x - selected.sourceRegion.minimum.x}
                          x={selected.sourceRegion.minimum.x}
                          y={selected.sourceRegion.minimum.y}
                        />
                      ) : null;
                    })()
                  : null}
              </g>
            ) : null}
          </g>
        </svg>
      </div>
    </section>
  );
}
