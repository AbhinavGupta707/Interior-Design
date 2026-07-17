import type { ReconstructionWorkspace } from "./contracts";

export function RuntimeStatus({
  capabilities,
}: {
  readonly capabilities: ReconstructionWorkspace["capabilities"];
}) {
  const entries = [
    ["Geometry worker", capabilities.geometryWorker],
    ["Appearance provider", capabilities.appearanceProvider],
    ["GPU runtime", capabilities.gpu],
  ] as const;
  return (
    <section aria-labelledby="runtime-status-title" className="runtime-status">
      <div>
        <span className="eyebrow">Local runtime truth</span>
        <h2 id="runtime-status-title">Capability status</h2>
        <p>
          Missing providers or hardware never become fixture output. A job can remain durably queued
          until an eligible worker is configured.
        </p>
      </div>
      <ul>
        {entries.map(([label, status]) => (
          <li key={label}>
            <span aria-hidden="true" className="capability-dot" data-state={status} />
            <span>{label}</span>
            <strong>{status}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}
