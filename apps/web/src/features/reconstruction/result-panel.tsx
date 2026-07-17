import type { ReconstructionResult } from "@interior-design/contracts";

import { diagnosticMessage } from "./presentation";

function ratio(registered: number, input: number): string {
  return new Intl.NumberFormat("en-GB", { style: "percent" }).format(registered / input);
}

export function ReconstructionResultPanel({ result }: { readonly result: ReconstructionResult }) {
  if (result.status === "abstained") {
    return (
      <section aria-labelledby="reconstruction-result-title" className="reconstruction-result">
        <header>
          <span className="status-chip" data-state="attention">
            Abstained safely
          </span>
          <h2 id="reconstruction-result-title">No geometry proposal was published</h2>
          <p>
            The pipeline kept the diagnostic result immutable and did not invent missing geometry.
          </p>
        </header>
        <div className="diagnostic-list">
          {[result.safeCode, ...result.findings]
            .filter((code, index, values) => values.indexOf(code) === index)
            .map((code) => (
              <article key={code}>
                <strong>{code}</strong>
                <p>{diagnosticMessage(code)}</p>
              </article>
            ))}
        </div>
      </section>
    );
  }

  const partial = result.geometry.registeredFrameCount < result.geometry.inputFrameCount;
  const disconnected = result.geometry.componentCount > 1;
  return (
    <section aria-labelledby="reconstruction-result-title" className="reconstruction-result">
      <header>
        <span className="status-chip" data-state="complete">
          Proposal published
        </span>
        <h2 id="reconstruction-result-title">Reconstruction result</h2>
        <p>
          Geometry is proposal-only evidence. It has not changed the canonical home model and is not
          survey or professional truth.
        </p>
      </header>

      <div className="result-metrics" role="list" aria-label="Geometry result summary">
        <div role="listitem">
          <span>Registered frames</span>
          <strong>
            {result.geometry.registeredFrameCount}/{result.geometry.inputFrameCount}
          </strong>
          <small>
            {ratio(result.geometry.registeredFrameCount, result.geometry.inputFrameCount)}
          </small>
        </div>
        <div role="listitem">
          <span>Components</span>
          <strong>{result.geometry.componentCount}</strong>
          <small>{disconnected ? "Disconnected" : "Single component"}</small>
        </div>
        <div role="listitem">
          <span>Scale</span>
          <strong>{result.geometry.scaleStatus.replaceAll("-", " ")}</strong>
          <small>{result.geometry.unit}</small>
        </div>
      </div>

      {partial || disconnected || result.geometry.scaleStatus === "unknown" ? (
        <div className="truth-boundary" role="note">
          <strong>Known limitations stay visible</strong>
          <ul>
            {partial ? <li>Some prepared frames did not register.</li> : null}
            {disconnected ? <li>Disconnected components were not silently merged.</li> : null}
            {result.geometry.scaleStatus === "unknown" ? (
              <li>Scale remains unknown and uses arbitrary units.</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <div className="result-separation">
        <article>
          <span className="eyebrow">Geometry · proposal-only</span>
          <h3>{result.geometry.artifacts.length} immutable artifact records</h3>
          <p>Calibrated cameras and geometry retain exact source/tool manifest hashes.</p>
        </article>
        <article>
          <span className="eyebrow">Appearance · non-dimensional</span>
          <h3>
            {result.appearance
              ? `${result.appearance.method} layer published`
              : "No layer published"}
          </h3>
          <p>
            {result.appearance
              ? "This optional visual layer cannot provide scale or overwrite geometry."
              : "Geometry remains separate and no appearance output is being implied."}
          </p>
        </article>
      </div>

      {result.findings.length > 0 ? (
        <div className="diagnostic-list" aria-label="Result diagnostics">
          {result.findings.map((code) => (
            <article key={code}>
              <strong>{code}</strong>
              <p>{diagnosticMessage(code)}</p>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
