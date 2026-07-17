import type { SceneElementMapping, SceneManifest } from "@interior-design/contracts";

interface DomSceneFallbackProps {
  readonly manifest: SceneManifest;
  readonly onSelect: (elementId: string) => void;
  readonly reason: string;
  readonly selectedElementId: string | undefined;
  readonly title?: string;
  readonly visibleLevelIds: ReadonlySet<string>;
}

export function DomSceneFallback({
  manifest,
  onSelect,
  reason,
  selectedElementId,
  title = "2D and DOM scene fallback",
  visibleLevelIds,
}: DomSceneFallbackProps) {
  const levels = manifest.elementMappings.filter(({ elementType }) => elementType === "level");
  const mappings = [...manifest.elementMappings].sort((left, right) =>
    left.elementId.localeCompare(right.elementId),
  );
  const width = Math.max(1, manifest.boundsMm.maximum.xMm - manifest.boundsMm.minimum.xMm);
  const depth = Math.max(1, manifest.boundsMm.maximum.yMm - manifest.boundsMm.minimum.yMm);
  const aspect = Math.min(2.4, Math.max(0.45, width / depth));

  return (
    <section
      className="scene-fallback"
      aria-labelledby="scene-fallback-title"
      data-testid="scene-fallback"
    >
      <header>
        <div>
          <span>Progressive enhancement fallback</span>
          <h3 id="scene-fallback-title">{title}</h3>
        </div>
        <p>{reason}</p>
      </header>
      <div className="scene-fallback__overview">
        <svg
          aria-label="Top-down model bounds overview; not a floor plan"
          role="img"
          style={{ aspectRatio: String(aspect) }}
          viewBox="0 0 100 100"
        >
          <rect height="88" width="88" x="6" y="6" />
          <path d="M6 94 94 6" />
          <text x="10" y="18">
            Bounds only
          </text>
          <text x="10" y="88">
            Not surveyed
          </text>
        </svg>
        <dl>
          <div>
            <dt>Exact snapshot</dt>
            <dd>
              <code>{manifest.sourceSnapshot.snapshotSha256}</code>
            </dd>
          </div>
          <div>
            <dt>Profile</dt>
            <dd>{manifest.sourceSnapshot.profile}</dd>
          </div>
          <div>
            <dt>Mapped / omitted</dt>
            <dd>
              {String(mappings.filter(({ status }) => status === "mapped").length)} /{" "}
              {String(mappings.filter(({ status }) => status === "omitted").length)}
            </dd>
          </div>
          <div>
            <dt>Visible levels</dt>
            <dd>
              {levels.length === 0
                ? "No mapped level groups"
                : `${String(visibleLevelIds.size)} of ${String(levels.length)}`}
            </dd>
          </div>
        </dl>
      </div>
      <ElementList mappings={mappings} onSelect={onSelect} selectedElementId={selectedElementId} />
    </section>
  );
}

export function ElementList({
  mappings,
  onSelect,
  selectedElementId,
}: {
  readonly mappings: readonly SceneElementMapping[];
  readonly onSelect: (elementId: string) => void;
  readonly selectedElementId: string | undefined;
}) {
  return (
    <div className="scene-element-list">
      <h3>Canonical element list</h3>
      {mappings.length === 0 ? (
        <p>No elements were mapped. The exact snapshot reference is still available above.</p>
      ) : (
        <ul>
          {mappings.map((mapping) => (
            <li key={mapping.elementId}>
              <button
                aria-pressed={selectedElementId === mapping.elementId}
                data-status={mapping.status}
                onClick={() => {
                  onSelect(mapping.elementId);
                }}
                type="button"
              >
                <span>{mapping.elementType}</span>
                <code>{mapping.elementId}</code>
                <small>
                  {mapping.status}
                  {mapping.findingCodes.length > 0 ? ` · ${mapping.findingCodes.join(", ")}` : ""}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ElementInspector({
  manifest,
  selectedElementId,
}: {
  readonly manifest: SceneManifest;
  readonly selectedElementId: string | undefined;
}) {
  const mapping = manifest.elementMappings.find(({ elementId }) => elementId === selectedElementId);
  const findings = mapping
    ? manifest.findings.filter(({ code }) => mapping.findingCodes.includes(code))
    : [];
  return (
    <aside className="scene-inspector" aria-labelledby="scene-inspector-title">
      <header>
        <span>Read-only inspector</span>
        <h3 id="scene-inspector-title">{mapping ? mapping.elementType : "Select an element"}</h3>
      </header>
      {mapping ? (
        <>
          <dl>
            <div>
              <dt>Canonical ID</dt>
              <dd>
                <code>{mapping.elementId}</code>
              </dd>
            </div>
            <div>
              <dt>Mapping</dt>
              <dd>{mapping.status}</dd>
            </div>
            <div>
              <dt>Source profile</dt>
              <dd>{manifest.sourceSnapshot.profile}</dd>
            </div>
            <div>
              <dt>Source hash</dt>
              <dd>
                <code>{manifest.sourceSnapshot.snapshotSha256}</code>
              </dd>
            </div>
          </dl>
          {findings.length > 0 ? (
            <ul className="scene-finding-list">
              {findings.map((finding) => (
                <li key={finding.code} data-severity={finding.severity}>
                  <strong>{finding.code}</strong>
                  <span>{finding.detail}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>No scene finding is attached to this mapped element.</p>
          )}
        </>
      ) : (
        <p>
          Choose a canonical ID in the list or the canvas. Display names are never used as identity.
        </p>
      )}
      <p className="scene-inspector__boundary">
        Derived visualisation only. This view does not establish surveyed dimensions, structure,
        compliance, professional approval or a traversable route.
      </p>
    </aside>
  );
}
