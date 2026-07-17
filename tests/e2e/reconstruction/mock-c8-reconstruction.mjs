import http from "node:http";

const port = 4318;

const css = String.raw`
  :root { color-scheme: light; font-family: ui-sans-serif, system-ui, sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #17211b; background: #f5f4ef; }
  button, input, select { font: inherit; }
  button, select { min-height: 44px; }
  button:focus-visible, input:focus-visible, select:focus-visible, a:focus-visible {
    outline: 3px solid #185f4a; outline-offset: 3px;
  }
  .skip { position: absolute; left: -9999px; }
  .skip:focus { left: 1rem; top: 1rem; z-index: 2; background: white; padding: .75rem; }
  header { padding: 1rem clamp(1rem, 4vw, 3rem); background: #173f35; color: white; }
  header p { margin: .35rem 0 0; }
  main { width: min(1120px, 100%); margin: auto; padding: clamp(1rem, 4vw, 3rem); }
  .fixture { border: 2px solid #8b5d10; background: #fff4d6; padding: .85rem; }
  .grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(18rem, .85fr); gap: 1rem; }
  .card { min-width: 0; border: 1px solid #c8cec9; border-radius: .75rem; background: white; padding: 1rem; }
  fieldset { border: 0; padding: 0; margin: 0 0 1rem; }
  label { display: block; margin: .75rem 0; }
  .actions { display: flex; flex-wrap: wrap; gap: .65rem; }
  button { border: 0; border-radius: .4rem; padding: .65rem 1rem; background: #185f4a; color: white; }
  button.secondary { background: #49534e; }
  button:disabled { opacity: .55; }
  .status { border-left: .35rem solid #185f4a; padding: .25rem 1rem; margin: 1rem 0; }
  .warning { border-left-color: #a75b00; }
  .error { border-left-color: #9e2636; }
  dl { display: grid; grid-template-columns: minmax(8rem, auto) minmax(0, 1fr); gap: .5rem 1rem; }
  dd { margin: 0; overflow-wrap: anywhere; }
  .result-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
  [hidden] { display: none !important; }
  @media (max-width: 700px) {
    .grid, .result-grid { grid-template-columns: minmax(0, 1fr); }
    main { padding: 1rem; }
    dl { grid-template-columns: minmax(0, 1fr); }
    .actions button { width: 100%; }
  }
`;

const script = String.raw`
  const query = new URLSearchParams(location.search);
  const scenario = query.get("scenario") || "completed";
  const persona = query.get("persona") || "owner";
  const state = document.querySelector("#state");
  const detail = document.querySelector("#detail");
  const diagnostics = document.querySelector("#diagnostics");
  const results = document.querySelector("#results");
  const recovery = document.querySelector("#recovery");
  const cancel = document.querySelector("#cancel");
  const start = document.querySelector("#start");
  const source = document.querySelector("#source");
  const consent = document.querySelector("#consent");

  function present(title, copy, kind = "status") {
    state.textContent = title;
    detail.textContent = copy;
    state.parentElement.className = kind;
    state.tabIndex = -1;
    state.focus();
  }

  function completed(mode = scenario) {
    recovery.hidden = true;
    results.hidden = false;
    diagnostics.hidden = false;
    if (mode === "partial" || mode === "disconnected") {
      present("Partial reconstruction", "Six of ten frames registered. No component was hidden.", "status warning");
      diagnostics.innerHTML = "<dt>Registered frames</dt><dd>6 / 10</dd><dt>Components</dt><dd>2 · disconnected</dd><dt>Finding</dt><dd>DISCONNECTED_COMPONENTS</dd>";
    } else if (mode === "unknown-scale") {
      present("Completed with unknown scale", "Coordinates remain in arbitrary units until three independent correspondences validate scale.", "status warning");
      diagnostics.innerHTML = "<dt>Registered frames</dt><dd>10 / 10</dd><dt>Scale</dt><dd>Unknown · arbitrary units</dd><dt>Authority</dt><dd>Proposal only</dd>";
    } else {
      present("Reconstruction completed", "All ten synthetic frames registered to one proposal component.");
      diagnostics.innerHTML = "<dt>Registered frames</dt><dd>10 / 10</dd><dt>Components</dt><dd>1</dd><dt>Scale</dt><dd>Metric estimated · not validated</dd>";
    }
  }

  function run() {
    if (!source.checked || !consent.checked) return;
    start.disabled = true;
    cancel.hidden = false;
    results.hidden = true;
    diagnostics.hidden = true;
    present("Preparing privacy-reviewed frames", "Training use remains denied. The fixture source is immutable.");
    if (scenario === "error") {
      present("Reconstruction unavailable", "Safe code APPEARANCE_TOOL_UNAVAILABLE. No result was published.", "status error");
      recovery.hidden = false;
      cancel.hidden = true;
      return;
    }
    if (scenario === "offline") {
      present("Connection unavailable", "The durable job was not replaced by a fixture success.", "status error");
      recovery.hidden = false;
      cancel.hidden = true;
      return;
    }
    present("Reconstructing geometry", "Registration and component diagnostics are in progress.");
    if (scenario === "cancel") return;
    completed();
    cancel.hidden = true;
  }

  start.addEventListener("click", run);
  cancel.addEventListener("click", () => {
    present("Reconstruction cancelled", "Cancellation is terminal for attempt 1. No late result can publish.", "status warning");
    cancel.hidden = true;
    results.hidden = true;
    diagnostics.hidden = true;
    recovery.hidden = false;
  });
  recovery.addEventListener("click", () => {
    present("Replacement attempt ready", "Attempt 2 is fenced from the cancelled or failed attempt.");
    recovery.hidden = true;
    results.hidden = true;
    diagnostics.hidden = true;
    start.disabled = false;
    if (scenario === "error" || scenario === "offline") completed("completed");
  });
  source.addEventListener("change", () => { start.disabled = !(source.checked && consent.checked); });
  consent.addEventListener("change", () => { start.disabled = !(source.checked && consent.checked); });

  if (persona === "viewer") {
    document.querySelector("#viewer-note").hidden = false;
    document.querySelector("#mutation-controls").hidden = true;
    completed(scenario);
  }
`;

function page() {
  return `<!doctype html>
  <html lang="en-GB">
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>C8 synthetic reconstruction acceptance</title><style>${css}</style></head>
    <body>
      <a class="skip" href="#main">Skip to reconstruction workspace</a>
      <header><strong>Home Design Studio</strong><p>Guided media reconstruction</p></header>
      <main id="main">
        <p class="fixture" role="note">Local fixture · Visibly synthetic · No live API, worker, camera, customer media, Nerfstudio, gsplat or CUDA evidence.</p>
        <h1>Reconstruct a proposal from guided media</h1>
        <p>Geometry is proposal-only. Optional appearance is non-dimensional and cannot confirm or mutate the home model.</p>
        <p id="viewer-note" role="status" hidden>Viewer read-only mode. You can inspect diagnostics but cannot start, cancel, retry or publish.</p>
        <div class="grid">
          <section class="card" aria-labelledby="sources-heading">
            <h2 id="sources-heading">Rights-cleared source selection</h2>
            <div id="mutation-controls">
              <fieldset><legend>Immutable synthetic evidence</legend><label><input id="source" type="checkbox"> Ten generated room frames · public-domain fixture</label></fieldset>
              <label><input id="consent" type="checkbox"> Allow service processing for this reconstruction</label>
              <label><input type="radio" checked disabled> Training use denied</label>
              <label><input type="checkbox" checked> Generate optional appearance after geometry</label>
              <div class="actions"><button id="start" disabled>Start reconstruction</button><button class="secondary" id="cancel" hidden>Cancel attempt</button><button class="secondary" id="recovery" hidden>Retry with replacement attempt</button></div>
            </div>
          </section>
          <section class="card" aria-labelledby="status-heading">
            <h2 id="status-heading">Durable job status</h2>
            <div class="status" aria-live="polite"><h3 id="state">Ready for source consent</h3><p id="detail">No source has been submitted.</p></div>
            <dl id="diagnostics" hidden></dl>
          </section>
        </div>
        <section id="results" class="card" aria-labelledby="result-heading" hidden>
          <h2 id="result-heading">Reconstruction result</h2>
          <div class="result-grid">
            <article><h3>Geometry proposal</h3><p>Proposal only · explicit scale and component diagnostics · never canonical truth.</p><button type="button">Open read-only proposal viewer</button></article>
            <article><h3>Optional appearance</h3><p>Non-dimensional Nerfstudio/gsplat appearance · cannot provide metric scale or overwrite geometry.</p><button type="button">Open non-dimensional appearance</button></article>
          </div>
        </section>
      </main>
      <script>${script}</script>
    </body>
  </html>`;
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"status":"ok"}');
    return;
  }
  if (url.pathname === "/reconstruction") {
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'",
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
    });
    response.end(page());
    return;
  }
  response.writeHead(404, { "content-type": "text/plain" });
  response.end("not found");
});

server.listen(port, "127.0.0.1");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
