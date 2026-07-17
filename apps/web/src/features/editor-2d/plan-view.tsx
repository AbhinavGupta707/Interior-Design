"use client";

import type { ProjectedElement, ProjectedPlan } from "@interior-design/editor-core";
import { useMemo, useState } from "react";
import type { KeyboardEvent } from "react";

interface PlanViewProps {
  readonly onSelect: (elementId: string) => void;
  readonly plan: ProjectedPlan;
}

interface ViewTransform {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly zoom: number;
}

const initialTransform: ViewTransform = { offsetX: 0, offsetY: 0, zoom: 1 };

function activateWithKeyboard(event: KeyboardEvent<SVGGElement>, action: () => void): void {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    action();
  }
}

function pointsAttribute(element: ProjectedElement): string {
  return element.points.map(({ x, y }) => `${String(x)},${String(y)}`).join(" ");
}

function centroid(element: ProjectedElement) {
  const count = Math.max(1, element.points.length);
  const total = element.points.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 },
  );
  return { x: total.x / count, y: total.y / count };
}

export function PlanView({ onSelect, plan }: PlanViewProps) {
  const [transform, setTransform] = useState<ViewTransform>(initialTransform);
  const renderedViewBox = useMemo(() => {
    const width = plan.viewBox.width / transform.zoom;
    const height = plan.viewBox.height / transform.zoom;
    return {
      height,
      width,
      x: plan.viewBox.x + (plan.viewBox.width - width) / 2 + transform.offsetX,
      y: plan.viewBox.y + (plan.viewBox.height - height) / 2 + transform.offsetY,
    };
  }, [plan.viewBox, transform]);
  const panStep = Math.max(100, Math.round(plan.viewBox.width / 10));

  function pan(x: number, y: number): void {
    setTransform((current) => ({
      ...current,
      offsetX: current.offsetX + x,
      offsetY: current.offsetY + y,
    }));
  }

  function zoom(multiplier: number): void {
    setTransform((current) => ({
      ...current,
      zoom: Math.min(3, Math.max(0.5, current.zoom * multiplier)),
    }));
  }

  return (
    <section className="editor-plan" aria-labelledby="plan-title">
      <header className="editor-plan__header">
        <div>
          <h2 id="plan-title">Canonical plan</h2>
          <p>Exact millimetres are converted only at this SVG boundary.</p>
        </div>
        <div aria-label="Plan pan and zoom" className="editor-plan__tools" role="toolbar">
          <button
            aria-label="Zoom out"
            onClick={() => {
              zoom(0.8);
            }}
            type="button"
          >
            −
          </button>
          <span aria-live="polite">{Math.round(transform.zoom * 100)}%</span>
          <button
            aria-label="Zoom in"
            onClick={() => {
              zoom(1.25);
            }}
            type="button"
          >
            +
          </button>
          <button
            aria-label="Pan left"
            onClick={() => {
              pan(-panStep, 0);
            }}
            type="button"
          >
            ←
          </button>
          <button
            aria-label="Pan up"
            onClick={() => {
              pan(0, -panStep);
            }}
            type="button"
          >
            ↑
          </button>
          <button
            aria-label="Pan down"
            onClick={() => {
              pan(0, panStep);
            }}
            type="button"
          >
            ↓
          </button>
          <button
            aria-label="Pan right"
            onClick={() => {
              pan(panStep, 0);
            }}
            type="button"
          >
            →
          </button>
          <button
            onClick={() => {
              setTransform(initialTransform);
            }}
            type="button"
          >
            Fit
          </button>
        </div>
      </header>
      <div className="editor-plan__surface">
        <svg
          aria-describedby="plan-description"
          className="editor-plan__svg"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          viewBox={[
            renderedViewBox.x,
            renderedViewBox.y,
            renderedViewBox.width,
            renderedViewBox.height,
          ].join(" ")}
        >
          <title>Editable canonical floor plan</title>
          <desc id="plan-description">
            Selectable walls, openings, spaces and stairs for the current level. The element list
            after the plan provides the same selection without a pointer.
          </desc>
          <defs>
            <pattern height="500" id="editor-grid" patternUnits="userSpaceOnUse" width="500">
              <path className="editor-grid-line" d="M 500 0 L 0 0 0 500" fill="none" />
            </pattern>
          </defs>
          <rect
            fill="url(#editor-grid)"
            height={renderedViewBox.height}
            width={renderedViewBox.width}
            x={renderedViewBox.x}
            y={renderedViewBox.y}
          />
          {plan.elements.map((element) => {
            const selected = element.selected;
            const common = {
              "aria-label": `${element.kind}: ${element.label}${selected ? ", selected" : ""}`,
              "data-kind": element.kind,
              "data-selected": selected,
              onClick: () => {
                onSelect(element.id);
              },
              onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
                activateWithKeyboard(event, () => {
                  onSelect(element.id);
                });
              },
              role: "button" as const,
              tabIndex: 0,
            };
            if (element.kind === "space") {
              const label = centroid(element);
              return (
                <g key={element.id} {...common}>
                  <polygon className="editor-plan-space" points={pointsAttribute(element)} />
                  <text className="editor-plan-label" x={label.x} y={label.y}>
                    {element.label}
                  </text>
                </g>
              );
            }
            if (element.kind === "opening") {
              const point = element.points[0];
              if (!point) return null;
              return (
                <g key={element.id} {...common}>
                  <circle
                    className="editor-plan-opening"
                    cx={point.x}
                    cy={point.y}
                    r={Math.max(90, element.strokeWidth / 5)}
                  />
                </g>
              );
            }
            return (
              <g key={element.id} {...common}>
                <polyline
                  className={`editor-plan-${element.kind}`}
                  points={pointsAttribute(element)}
                  strokeWidth={element.strokeWidth}
                />
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

interface ElementListProps {
  readonly onSelect: (elementId: string) => void;
  readonly plan: ProjectedPlan;
}

export function ElementList({ onSelect, plan }: ElementListProps) {
  return (
    <section className="editor-elements" aria-labelledby="element-list-title">
      <header>
        <h2 id="element-list-title">Elements on this level</h2>
        <span>{plan.elements.length}</span>
      </header>
      {plan.elements.length === 0 ? (
        <p>No projectable elements are present on this level.</p>
      ) : (
        <ul>
          {plan.elements.map((element) => (
            <li key={element.id}>
              <button
                aria-pressed={element.selected}
                data-selected={element.selected}
                onClick={() => {
                  onSelect(element.id);
                }}
                type="button"
              >
                <span>{element.label}</span>
                <small>
                  {element.kind} · {element.id.slice(0, 8)}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
