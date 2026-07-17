import http from "node:http";

const port = 4319;

const css = String.raw`
  :root { color-scheme: light; font-family: ui-sans-serif, system-ui, sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #15211d; background: #f2f1ec; }
  button, input, select, textarea { font: inherit; }
  button, select { min-height: 44px; }
  button:focus-visible, input:focus-visible, select:focus-visible, a:focus-visible {
    outline: 3px solid #0d6751; outline-offset: 3px;
  }
  .skip { position: absolute; left: -9999px; }
  .skip:focus { left: 1rem; top: 1rem; z-index: 5; padding: .75rem; background: white; }
  header { padding: 1rem clamp(1rem, 4vw, 3rem); color: white; background: #143f35; }
  header p { margin: .35rem 0 0; }
  main { width: min(1160px, 100%); margin: auto; padding: clamp(1rem, 4vw, 3rem); }
  .fixture { border: 2px solid #8a5700; background: #fff2c9; padding: .85rem; overflow-wrap: anywhere; }
  .grid { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(19rem, .95fr); gap: 1rem; }
  .result-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; }
  .card { min-width: 0; border: 1px solid #c3cbc6; border-radius: .75rem; background: white; padding: 1rem; }
  fieldset { min-width: 0; margin: 0 0 1rem; border: 1px solid #d5dad6; border-radius: .5rem; }
  label { display: block; margin: .7rem 0; }
  .actions { display: flex; flex-wrap: wrap; gap: .65rem; }
  button { border: 0; border-radius: .4rem; padding: .65rem 1rem; color: white; background: #14664f; }
  button.secondary { background: #4b5651; }
  button:disabled { opacity: .5; }
  .status { border-left: .35rem solid #14664f; padding: .25rem 1rem; margin: 1rem 0; }
  .warning { border-left-color: #a85a00; }
  .error { border-left-color: #a22638; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: .55rem; border-bottom: 1px solid #d9ddda; text-align: left; overflow-wrap: anywhere; }
  select { width: 100%; max-width: 32rem; }
  dl { display: grid; grid-template-columns: minmax(9rem, auto) minmax(0, 1fr); gap: .45rem 1rem; }
  dd { margin: 0; overflow-wrap: anywhere; }
  pre { max-width: 100%; overflow: auto; padding: 1rem; background: #eef2ef; white-space: pre-wrap; overflow-wrap: anywhere; }
  code { overflow-wrap: anywhere; }
  [hidden] { display: none !important; }
  @media (max-width: 700px) {
    .grid, .result-grid { grid-template-columns: minmax(0, 1fr); }
    main { padding: 1rem; }
    dl { grid-template-columns: minmax(0, 1fr); }
    .actions button { width: 100%; }
    table { display: block; overflow-x: auto; }
  }
`;

const script = String.raw`
  const query = new URLSearchParams(location.search);
  const scenario = query.get("scenario") || "full";
  const persona = query.get("persona") || "owner";
  const projectId = "c9000000-0000-4000-8000-000000000107";
  const jobId = "c9000000-0000-4000-8000-000000000104";
  const baseRoute = "/mock-api/v1/projects/" + projectId + "/fusion-jobs";
  const jobRoute = baseRoute + "/" + jobId;
  const create = document.querySelector("#create");
  const advance = document.querySelector("#advance");
  const cancel = document.querySelector("#cancel");
  const retry = document.querySelector("#retry");
  const state = document.querySelector("#state");
  const detail = document.querySelector("#detail");
  const results = document.querySelector("#results");
  const claims = document.querySelector("#claims");
  const decisions = document.querySelector("#decisions");
  const stale = document.querySelector("#stale");
  const draft = document.querySelector("#draft");
  const draftOutput = document.querySelector("#draft-output");
  const mutationControls = document.querySelector("#mutation-controls");
  const viewerNote = document.querySelector("#viewer-note");
  const consent = document.querySelector("#consent");
  const sources = [...document.querySelectorAll("input[name=source]")];
  let phase = 0;
  let attempt = 1;
  let recovered = false;
  let staleReloaded = false;

  function present(title, copy, kind = "status") {
    state.textContent = title;
    detail.textContent = copy;
    state.parentElement.className = kind;
    state.tabIndex = -1;
    state.focus();
  }

  async function post(route, body = {}) {
    const response = await fetch(route, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    if (!response.ok) throw new Error("Synthetic mock request failed with " + response.status);
    await response.json();
  }

  function updateCreate() {
    create.disabled = !(consent.checked && sources.filter((source) => source.checked).length >= 2);
  }

  function beginProgress() {
    phase = 0;
    results.hidden = true;
    claims.hidden = true;
    decisions.hidden = true;
    stale.hidden = true;
    draft.hidden = true;
    retry.hidden = true;
    advance.hidden = false;
    cancel.hidden = false;
    present("Registering source graph", "Attempt " + attempt + " preserves source transforms, residuals and disconnected components.");
  }

  async function createJob() {
    if (scenario === "offline" && !recovered) {
      present("Offline — fusion not submitted", "The source selection remains local. No fixture success replaced the unavailable service.", "status error");
      retry.hidden = false;
      return;
    }
    await post(baseRoute, { inferencePolicy: "label-and-expose", trainingUseConsent: "denied" });
    if (scenario === "error" && !recovered) {
      present("Fusion failed safely", "Safe code FUSION_WORKER_UNAVAILABLE. No proposal or canonical mutation was published.", "status error");
      retry.hidden = false;
      return;
    }
    beginProgress();
  }

  async function advanceJob() {
    phase += 1;
    if (phase === 1) {
      present("Comparing source claims", "Residuals, dimensions, topology, scale and unknown regions remain explicit.");
      return;
    }
    await post(jobRoute + "/mock-progress", { attempt, phase: "proposed" });
    renderOutcome(recovered ? "full" : scenario);
  }

  function renderOutcome(mode) {
    advance.hidden = true;
    cancel.hidden = true;
    results.hidden = false;
    draft.hidden = true;
    const outcome = document.querySelector("#outcome");
    const diagnostics = document.querySelector("#diagnostics");
    if (mode === "abstained") {
      present("Fusion abstained", "DEGENERATE_ANCHORS · no geometry was manufactured.", "status warning");
      outcome.textContent = "Honest abstention";
      diagnostics.innerHTML = "<dt>Authority</dt><dd>No proposal</dd><dt>Safe code</dt><dd>DEGENERATE_ANCHORS</dd><dt>Failures</dt><dd>Retained in denominator</dd>";
      claims.hidden = true;
      decisions.hidden = true;
      return;
    }
    claims.hidden = false;
    decisions.hidden = persona === "viewer";
    if (mode === "partial") {
      present("Partial full-house proposal", "Supported rooms are proposed; the occluded garage remains unknown.", "status warning");
      outcome.textContent = "Partial proposal · unknowns visible";
      diagnostics.innerHTML = "<dt>Levels</dt><dd>2</dd><dt>Coverage</dt><dd>8 / 10 supported regions</dd><dt>Unknown</dt><dd>Synthetic garage behind occlusion</dd><dt>Authority</dt><dd>Proposal only</dd>";
      return;
    }
    if (mode === "disconnected") {
      present("Disconnected partial proposal", "Two components remain separate. The upper floor was not silently moved into the main component.", "status warning");
      outcome.textContent = "Partial proposal · disconnected";
      diagnostics.innerHTML = "<dt>Levels</dt><dd>2</dd><dt>Components</dt><dd>2 · disconnected</dd><dt>Unknown</dt><dd>Upper eaves</dd><dt>Authority</dt><dd>Proposal only</dd>";
      return;
    }
    present("Full-house proposal ready", "Fusion improved the synthetic reference metrics; discrepancies still require decisions.");
    outcome.textContent = "Full-house proposal";
    diagnostics.innerHTML = "<dt>Levels</dt><dd>2</dd><dt>Components</dt><dd>1</dd><dt>Coverage</dt><dd>10 / 10 supported regions</dd><dt>Authority</dt><dd>Proposal only</dd>";
  }

  async function cancelJob() {
    await post(jobRoute + "/cancel", { attempt });
    advance.hidden = true;
    cancel.hidden = true;
    retry.hidden = false;
    present("Fusion cancelled", "Cancellation is terminal for attempt " + attempt + ". A late worker cannot publish.", "status warning");
  }

  async function retryJob() {
    if (scenario !== "offline") await post(jobRoute + "/retry", { expectedAttempt: attempt });
    attempt += 1;
    recovered = true;
    beginProgress();
  }

  function decisionsComplete() {
    return [...document.querySelectorAll("select[data-decision]")].every((select) => select.value !== "");
  }

  async function submitDecisions() {
    if (!decisionsComplete()) {
      present("Decisions incomplete", "Choose one explicit decision for every discrepancy.", "status error");
      return;
    }
    if (scenario === "stale" && !staleReloaded) {
      stale.hidden = false;
      present("Proposal changed before review", "Expected proposal version 1 is stale. Reload version 2 before submitting.", "status warning");
      return;
    }
    await post(jobRoute + "/proposal/discrepancy-decisions", {
      choices: [...document.querySelectorAll("select[data-decision]")].map((select) => select.value),
      expectedProposalVersion: staleReloaded ? 2 : 1
    });
    document.querySelector("#create-draft").disabled = false;
    present("Five decisions recorded", "Accept, keep, correct, unknown and defer remain attributable and versioned.");
  }

  function reloadProposal() {
    staleReloaded = true;
    stale.hidden = true;
    present("Proposal version 2 loaded", "Source claims and residuals were refreshed; no decision was silently replayed.");
  }

  async function createDraft() {
    await post(jobRoute + "/proposal/operation-drafts", {
      expectedBranchRevision: 7,
      expectedHeadSnapshotSha256: "d".repeat(64),
      expectedProposalVersion: staleReloaded ? 2 : 1
    });
    const payload = {
      schemaVersion: "c9-operation-draft-v1",
      branchId: "c9000000-0000-4000-8000-000000000102",
      expectedBranchRevision: 7,
      expectedHeadSnapshotSha256: "d".repeat(64),
      proposalId: "c9000000-0000-4000-8000-000000000108",
      baseSnapshotSha256: "a".repeat(64),
      decisions: ["accept-candidate", "keep-base", "correct", "mark-unknown", "defer"],
      operations: [{ kind: "move-wall-v1", deltaMillimetres: 25 }],
      authority: "draft only — zero canonical mutation"
    };
    draftOutput.textContent = JSON.stringify(payload, null, 2);
    draft.hidden = false;
    present("Exact operation draft ready", "The branch, revision and head hash are pinned. Preview and commit were not called.");
  }

  create.addEventListener("click", () => void createJob());
  advance.addEventListener("click", () => void advanceJob());
  cancel.addEventListener("click", () => void cancelJob());
  retry.addEventListener("click", () => void retryJob());
  consent.addEventListener("change", updateCreate);
  sources.forEach((source) => source.addEventListener("change", updateCreate));
  document.querySelector("#submit-decisions").addEventListener("click", () => void submitDecisions());
  document.querySelector("#reload-proposal").addEventListener("click", reloadProposal);
  document.querySelector("#create-draft").addEventListener("click", () => void createDraft());

  if (persona === "viewer") {
    viewerNote.hidden = false;
    mutationControls.hidden = true;
    renderOutcome(scenario === "abstained" ? "abstained" : scenario);
    decisions.remove();
  }
`;

function page() {
  return `<!doctype html>
  <html lang="en-GB">
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>C9 synthetic fusion acceptance</title><style>${css}</style></head>
    <body>
      <a class="skip" href="#main">Skip to fusion workspace</a>
      <header><strong>Home Design Studio</strong><p>Multi-source full-house fusion review</p></header>
      <main id="main">
        <p class="fixture" role="note">Local QA fixture · Visibly synthetic · No live C9 producer, API, database, RoomPlan device, COLMAP, Open3D, GPU, provider, customer home or human-study evidence.</p>
        <h1>Fuse evidence into a reviewable proposal</h1>
        <p>Source claims remain separate. Geometry is proposal-only; this workspace can create an exact C5 operation draft but cannot preview, commit, advance a branch or mutate a snapshot.</p>
        <p id="viewer-note" role="status" hidden>Viewer read-only mode. You can inspect claims, residuals, discrepancies and unknowns but cannot create, cancel, retry, decide or draft.</p>
        <div class="grid">
          <section class="card" aria-labelledby="sources-heading">
            <h2 id="sources-heading">Immutable synthetic sources</h2>
            <div id="mutation-controls">
              <fieldset><legend>Select at least two source kinds</legend>
                <label><input name="source" type="checkbox"> Synthetic plan proposal · exact hash</label>
                <label><input name="source" type="checkbox"> Synthetic RoomPlan proposal · exact hash</label>
                <label><input name="source" type="checkbox"> Synthetic reconstruction result · exact hash</label>
                <label><input name="source" type="checkbox"> Synthetic measurement set · exact hash</label>
                <label><input name="source" type="checkbox"> Synthetic attributable assertion · exact hash</label>
              </fieldset>
              <label><input id="consent" type="checkbox"> Allow service processing for this fusion</label>
              <label><input type="radio" checked disabled> Training use denied</label>
              <div class="actions">
                <button id="create" disabled>Create fusion job</button>
                <button id="advance" class="secondary" hidden>Advance synthetic job</button>
                <button id="cancel" class="secondary" hidden>Cancel attempt</button>
                <button id="retry" class="secondary" hidden>Retry with replacement attempt</button>
              </div>
            </div>
          </section>
          <section class="card" aria-labelledby="status-heading">
            <h2 id="status-heading">Durable job status</h2>
            <div class="status" aria-live="polite"><h3 id="state">Ready for source selection</h3><p id="detail">No fusion job exists.</p></div>
          </section>
        </div>
        <section id="results" class="card" aria-labelledby="result-heading" hidden>
          <h2 id="result-heading">Fusion result</h2>
          <div class="result-grid">
            <article><h3 id="outcome">Proposal</h3><p>Existing-condition candidate only. Inference and unknowns retain labels.</p></article>
            <article><h3>Residuals</h3><p>P90 18 mm · maximum 41 mm · 22 / 25 inliers.</p></article>
            <article><h3>Baseline comparison</h3><p>26% lower declared quality penalty than the best eligible single source · zero fused severe errors.</p></article>
          </div>
          <dl id="diagnostics"></dl>
        </section>
        <section id="claims" class="card" aria-labelledby="claims-heading" hidden>
          <h2 id="claims-heading">Source claims and residual review</h2>
          <p>Conflicting claims are not averaged into false agreement.</p>
          <table><thead><tr><th>Source</th><th>Claim</th><th>Residual</th><th>State</th></tr></thead>
            <tbody><tr><td>Plan proposal</td><td>Living width 5,000 mm</td><td>12 mm</td><td>source-derived</td></tr>
            <tr><td>RoomPlan proposal</td><td>Living width 5,075 mm</td><td>28 mm</td><td>source-derived</td></tr></tbody></table>
        </section>
        <section id="decisions" class="card" aria-labelledby="decision-heading" hidden>
          <h2 id="decision-heading">Attributable discrepancy decisions</h2>
          ${decisionSelect("dimension", "Dimension conflict")}
          ${decisionSelect("topology", "Topology conflict")}
          ${decisionSelect("classification", "Classification conflict")}
          ${decisionSelect("unknown", "Occluded region")}
          ${decisionSelect("scale", "Scale conflict")}
          <div class="actions"><button id="submit-decisions">Record five decisions</button><button id="create-draft" disabled>Create exact operation draft</button></div>
          <div id="stale" class="status warning" hidden><h3>Stale proposal conflict</h3><p>Version 1 cannot overwrite version 2.</p><button id="reload-proposal" class="secondary">Reload current proposal</button></div>
        </section>
        <section id="draft" class="card" aria-labelledby="draft-heading" hidden>
          <h2 id="draft-heading">Exact C5 operation draft</h2>
          <p>Draft only. Branch revision and head hash are pinned; canonical state is unchanged.</p>
          <pre id="draft-output"></pre>
        </section>
      </main>
      <script>${script}</script>
    </body>
  </html>`;
}

function decisionSelect(id, label) {
  return `<label for="decision-${id}">${label}</label><select id="decision-${id}" data-decision aria-label="Decision for ${label.toLowerCase()}"><option value="">Choose a decision</option><option value="accept-candidate">Accept candidate</option><option value="keep-base">Keep base</option><option value="correct">Correct with typed operation</option><option value="mark-unknown">Mark unknown</option><option value="defer">Defer</option></select>`;
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"status":"ok"}');
    return;
  }
  if (url.pathname === "/fusion") {
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'",
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
    });
    response.end(page());
    return;
  }
  if (url.pathname.startsWith("/mock-api/") && request.method === "POST") {
    let receivedBytes = 0;
    request.on("data", (chunk) => {
      receivedBytes += chunk.length;
      if (receivedBytes > 64 * 1_024) request.destroy();
    });
    request.on("end", () => {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'",
        "content-type": "application/json",
        "x-content-type-options": "nosniff",
      });
      response.end('{"accepted":true}');
    });
    return;
  }
  response.writeHead(404, { "content-type": "text/plain" });
  response.end("not found");
});

server.listen(port, "127.0.0.1");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
