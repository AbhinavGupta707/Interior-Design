import { createServer } from "node:http";

const host = "127.0.0.1";
const port = Number(process.env.C6_MOCK_PLAN_PORT ?? "4316");

const html = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>C6 reference plan correction harness</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #14251c; background: #f2efe7; }
    * { box-sizing: border-box; }
    body { margin: 0; min-width: 0; }
    header { padding: 1rem clamp(1rem, 4vw, 2.5rem); background: #163e2d; color: white; }
    header h1 { margin: 0; font-size: clamp(1.5rem, 4vw, 2.25rem); }
    header p { margin: .35rem 0 0; color: #dce8e1; }
    main { width: min(1240px, 100%); margin: 0 auto; padding: 1rem; min-width: 0; }
    button, input, select { font: inherit; max-width: 100%; }
    button { border: 1px solid #345846; border-radius: .5rem; background: white; color: #173829; padding: .6rem .8rem; cursor: pointer; }
    button.primary { background: #164d33; color: white; }
    button:disabled { cursor: not-allowed; opacity: .5; }
    button:focus-visible, input:focus-visible, select:focus-visible, a:focus-visible { outline: 3px solid #c45b18; outline-offset: 2px; }
    input, select { min-height: 2.55rem; padding: .45rem .55rem; border: 1px solid #879a90; border-radius: .45rem; }
    .notice, .card { background: white; border: 1px solid #c9d2cc; border-radius: .75rem; padding: .9rem; min-width: 0; }
    .notice { border-left: 5px solid #bd5a17; margin-bottom: 1rem; }
    .source-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .7rem; margin-bottom: 1rem; }
    .source-grid strong, .source-grid span { display: block; overflow-wrap: anywhere; }
    .toolbar, .actions { display: flex; flex-wrap: wrap; align-items: end; gap: .65rem; }
    .toolbar { margin: .8rem 0; }
    .field { display: grid; gap: .25rem; min-width: 0; }
    .workspace { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(18rem, .65fr); gap: 1rem; align-items: start; }
    .overlay { position: relative; overflow: auto; border: 1px solid #ced6d0; border-radius: .6rem; background: #fafaf7; }
    svg { display: block; width: 100%; height: auto; min-width: 0; }
    .source-layer { stroke: #3a4650; }
    .proposal-layer { stroke: #ba5415; }
    .candidate-list { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .7rem; }
    .candidate-list button[aria-pressed="true"] { background: #173e2c; color: white; }
    aside section + section { margin-top: 1rem; border-top: 1px solid #d5ddd8; padding-top: 1rem; }
    .two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .55rem; }
    .status { margin-top: .7rem; padding: .7rem; border-radius: .5rem; background: #edf4ef; overflow-wrap: anywhere; }
    .warning { background: #fff1d2; border: 1px solid #d49a29; }
    .error { background: #ffe7e2; border: 1px solid #b13a2c; }
    .success { background: #e2f4e7; border: 1px solid #357c4a; }
    [hidden] { display: none !important; }
    @media (max-width: 650px) {
      main { padding: .7rem; }
      .source-grid, .workspace, .two { grid-template-columns: minmax(0, 1fr); }
      .toolbar > *, .actions > * { flex: 1 1 100%; }
      .toolbar button, .actions button { width: 100%; }
      .card { padding: .75rem; }
    }
    @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; transition: none !important; } }
  </style>
</head>
<body>
  <header>
    <h1>Floor-plan proposal and correction</h1>
    <p>One synthetic, rights-cleared page. Proposal only; never a survey.</p>
  </header>
  <main>
    <div class="notice" role="note"><strong>Reference acceptance harness only.</strong> Passing here does not count as producer, API, database or live UI evidence.</div>
    <section class="card" aria-labelledby="source-heading">
      <h2 id="source-heading">Pinned source</h2>
      <div class="source-grid">
        <div><strong>Filename</strong><span>c6-synthetic-plan.svg</span></div>
        <div><strong>Rights</strong><span>Creator dedicated · processing allowed · training denied</span></div>
        <div><strong>Page</strong><span>1 of 1</span></div>
        <div><strong>SHA-256</strong><span>b204f1247ea5…</span></div>
      </div>
      <div class="toolbar" aria-label="Job controls">
        <label class="field">Persona
          <select id="persona" aria-label="Plan workspace persona"><option value="owner">Owner</option><option value="editor">Editor</option><option value="viewer">Viewer</option></select>
        </label>
        <button id="start" class="primary" data-mutation>Start plan processing</button>
        <button id="cancel" data-mutation hidden>Cancel processing</button>
        <button id="replacement" data-mutation hidden>Start replacement job</button>
        <button id="retry" data-mutation hidden>Retry failed job</button>
      </div>
      <div id="job-status" class="status" role="status" aria-live="polite">Ready to start a bounded plan job.</div>
      <div id="abstention" class="status warning" role="alert" hidden>
        <strong>Proposal unavailable · low confidence.</strong>
        <p>The source remains unchanged. Select another page, add a known dimension, use the manual editor or request professional input.</p>
        <a href="#manual-fallback" id="manual-link">Open the manual C5 editor</a>
      </div>
    </section>

    <div id="proposal-workspace" class="workspace" hidden>
      <section class="card" aria-labelledby="overlay-heading">
        <h2 id="overlay-heading">Source and proposal overlay</h2>
        <div class="toolbar" aria-label="Overlay controls">
          <button id="source-toggle" aria-pressed="true">Toggle source</button>
          <button id="proposal-toggle" aria-pressed="true">Toggle proposal</button>
          <label class="field">Proposal opacity
            <input id="opacity" aria-label="Proposal opacity" type="range" min="0" max="100" value="70">
          </label>
          <button id="zoom-in">Zoom in</button><button id="zoom-out">Zoom out</button><button id="reset-view">Reset view</button>
        </div>
        <div class="overlay">
          <svg viewBox="0 0 700 500" role="img" aria-labelledby="plan-title plan-description">
            <title id="plan-title">Safe derived synthetic plan overlay</title>
            <desc id="plan-description">Source and proposal straight-wall primitives for two synthetic rooms.</desc>
            <g id="source-layer" class="source-layer" fill="none" stroke-width="10"><rect x="50" y="50" width="600" height="390"/><line x1="390" y1="50" x2="390" y2="440"/></g>
            <g id="proposal-layer" class="proposal-layer" fill="none" stroke-width="5" opacity=".7"><rect x="54" y="54" width="592" height="382"/><line x1="388" y1="54" x2="388" y2="436"/><line x1="388" y1="310" x2="388" y2="370" stroke="white" stroke-width="12"/></g>
            <text x="115" y="245">Synthetic room A</text><text x="465" y="245">Synthetic room B</text>
          </svg>
        </div>
        <nav class="candidate-list" aria-label="Plan candidates">
          <button data-candidate="wall-1" aria-pressed="true">Wall 1 · 94%</button>
          <button data-candidate="opening-1" aria-pressed="false">Door 1 · 87%</button>
          <button data-candidate="space-1" aria-pressed="false">Space 1 · 68%</button>
        </nav>
        <p id="candidate-detail" class="status">Wall 1 · source region x54–646 y54–436 · inferred proposal · unresolved decision.</p>
      </section>

      <aside class="card" aria-labelledby="inspector-heading">
        <h2 id="inspector-heading">Structured keyboard inspector</h2>
        <section data-mutation>
          <h3>Known-length calibration</h3>
          <div class="two">
            <label class="field">Source start X<input id="start-x" type="number" value="50"></label>
            <label class="field">Source start Y<input id="start-y" type="number" value="50"></label>
            <label class="field">Source end X<input id="end-x" type="number" value="550"></label>
            <label class="field">Source end Y<input id="end-y" type="number" value="50"></label>
          </div>
          <label class="field">Known length (mm)<input id="known-length" type="number" value="5000"></label>
          <button id="confirm-calibration" class="primary">Confirm calibration evidence</button>
          <div id="calibration-status" class="status">No valid calibration. Overlay-only review; drafting is blocked.</div>
        </section>
        <section data-mutation>
          <h3>Candidate decision</h3>
          <label class="field">Decision
            <select id="decision" aria-label="Candidate decision"><option value="accepted">Accepted</option><option value="corrected">Corrected</option><option value="excluded">Excluded</option><option value="unresolved" selected>Unresolved</option></select>
          </label>
          <div class="two">
            <label class="field">Corrected start X<input id="corrected-start-x" type="number" value="54"></label>
            <label class="field">Corrected end X<input id="corrected-end-x" type="number" value="646"></label>
          </div>
          <button id="apply-decision" class="primary">Apply candidate decision</button>
        </section>
        <section data-mutation>
          <h3>Review and C5 handoff</h3>
          <button id="review">Build operation review</button>
          <div id="review-summary" class="status">Decisions unresolved. No operation draft exists.</div>
          <label id="warning-ack-wrap" hidden><input id="warning-ack" type="checkbox"> I acknowledge the synthetic-source limitation.</label>
          <div class="actions">
            <button id="preview" disabled>Send exact draft to C5 preview</button>
            <button id="remote-commit">Simulate second-session commit</button>
            <button id="commit" disabled>Commit exact C5 preview</button>
          </div>
          <div id="conflict" class="status error" role="alert" hidden><strong>Branch revision conflict.</strong><p>Candidate decisions and exact integer corrections are preserved.</p><button id="rebase">Reload head and reapply draft</button></div>
        </section>
        <div id="announcer" class="status" role="status" aria-live="polite" tabindex="-1">No canonical mutation has occurred.</div>
      </aside>
    </div>
  </main>
  <script>
    const ui = Object.fromEntries(Array.from(document.querySelectorAll('[id]')).map(function (element) { return [element.id, element]; }));
    const scenario = new URLSearchParams(location.search).get('scenario') || 'valid';
    const storageKey = 'c6-reference-' + scenario;
    const candidateLabels = { 'wall-1': 'Wall 1 · source region x54–646 y54–436 · inferred proposal', 'opening-1': 'Door 1 · hosted by Wall 1 · source region x388 y310–370', 'space-1': 'Space 1 · bounded by four walls · confidence requires review' };
    let state = JSON.parse(sessionStorage.getItem(storageKey) || 'null') || { role: 'owner', job: 'ready', selected: 'wall-1', decisions: {}, calibrated: false, draft: false, preview: false, conflict: false, revision: 7, sourceVisible: true, proposalVisible: true };

    function save() { sessionStorage.setItem(storageKey, JSON.stringify(state)); }
    function announce(message) { ui.announcer.textContent = message; ui.announcer.focus(); }
    function render() {
      ui.persona.value = state.role;
      document.querySelectorAll('[data-mutation]').forEach(function (element) { element.hidden = state.role === 'viewer'; });
      ui.start.hidden = state.role === 'viewer' || state.job !== 'ready';
      ui.cancel.hidden = state.role === 'viewer' || state.job !== 'processing';
      ui.replacement.hidden = state.role === 'viewer' || state.job !== 'cancelled';
      ui.retry.hidden = state.role === 'viewer' || state.job !== 'failed';
      ui['proposal-workspace'].hidden = !['proposed', 'committed'].includes(state.job);
      ui.abstention.hidden = state.job !== 'abstained';
      const statusMessages = { ready: 'Ready to start a bounded plan job.', processing: 'Processing attempt 1 of 3 · cancellation is available.', cancelled: 'Cancelled. No proposal was published and source evidence remains immutable.', failed: 'Failed with safe code PARSER_UNAVAILABLE · retryable attempt 1 of 3.', proposed: 'Proposal ready · immutable source and proposal hashes are pinned.', committed: 'C5 commit recorded at branch revision ' + state.revision + '.' };
      ui['job-status'].textContent = statusMessages[state.job] || state.job;
      ui['source-layer'].hidden = !state.sourceVisible;
      ui['proposal-layer'].hidden = !state.proposalVisible;
      ui['source-toggle'].setAttribute('aria-pressed', String(state.sourceVisible));
      ui['proposal-toggle'].setAttribute('aria-pressed', String(state.proposalVisible));
      document.querySelectorAll('[data-candidate]').forEach(function (button) { button.setAttribute('aria-pressed', String(button.dataset.candidate === state.selected)); });
      const decision = state.decisions[state.selected] || 'unresolved';
      ui.decision.value = decision;
      ui['candidate-detail'].textContent = candidateLabels[state.selected] + ' · ' + decision + ' decision.';
      ui['calibration-status'].textContent = state.calibrated ? 'Confirmed · 10 mm/source unit · residual 12 mm · immutable evidence calibration-1.' : 'No valid calibration. Overlay-only review; drafting is blocked.';
      ui.preview.disabled = !state.draft;
      ui.commit.disabled = !state.preview;
      ui.conflict.hidden = !state.conflict;
      save();
    }

    ui.persona.addEventListener('change', function () { state.role = ui.persona.value; render(); announce(state.role === 'viewer' ? 'Viewer read-only mode.' : state.role + ' editing mode.'); });
    ui.start.addEventListener('click', function () { if (scenario === 'abstention') state.job = 'abstained'; else state.job = scenario === 'cancel-retry' ? 'processing' : 'proposed'; render(); });
    ui.cancel.addEventListener('click', function () { state.job = 'cancelled'; render(); });
    ui.replacement.addEventListener('click', function () { state.job = 'failed'; render(); });
    ui.retry.addEventListener('click', function () { state.job = 'proposed'; render(); announce('Retry attempt 2 of 3 produced one proposal.'); });
    ui['source-toggle'].addEventListener('click', function () { state.sourceVisible = !state.sourceVisible; render(); });
    ui['proposal-toggle'].addEventListener('click', function () { state.proposalVisible = !state.proposalVisible; render(); });
    ui.opacity.addEventListener('input', function () { ui['proposal-layer'].setAttribute('opacity', String(Number(ui.opacity.value) / 100)); });
    document.querySelectorAll('[data-candidate]').forEach(function (button) { button.addEventListener('click', function () { state.selected = button.dataset.candidate; render(); }); });
    ui['confirm-calibration'].addEventListener('click', function () { state.calibrated = Number(ui['known-length'].value) > 0 && (ui['start-x'].value !== ui['end-x'].value || ui['start-y'].value !== ui['end-y'].value); render(); announce(state.calibrated ? 'Calibration confirmed.' : 'Calibration evidence is invalid.'); });
    ui['apply-decision'].addEventListener('click', function () { state.decisions[state.selected] = ui.decision.value; state.draft = false; state.preview = false; render(); announce('Decision ' + ui.decision.value + ' recorded for ' + state.selected + '.'); });
    ui.review.addEventListener('click', function () { const values = ['wall-1', 'opening-1', 'space-1'].map(function (id) { return state.decisions[id] || 'unresolved'; }); const unresolved = values.filter(function (value) { return value === 'unresolved'; }).length; const accepted = values.filter(function (value) { return value === 'accepted'; }).length; const corrected = values.filter(function (value) { return value === 'corrected'; }).length; const excluded = values.filter(function (value) { return value === 'excluded'; }).length; const operations = accepted + corrected; state.draft = state.calibrated && unresolved === 0 && operations > 0; state.preview = false; ui['review-summary'].textContent = 'Operations ' + operations + ' · accepted ' + accepted + ' · corrected ' + corrected + ' · excluded ' + excluded + ' · unresolved ' + unresolved + ' · target revision ' + state.revision + ' · head 7b0c34f… · commit has not occurred.'; ui['warning-ack-wrap'].hidden = !state.draft; render(); });
    ui['warning-ack'].addEventListener('change', function () { if (!ui['warning-ack'].checked) state.preview = false; render(); });
    ui.preview.addEventListener('click', function () { if (!ui['warning-ack'].checked) { announce('Acknowledge the synthetic-source limitation before preview.'); return; } state.preview = true; render(); announce('Exact typed C5 preview ready. Canonical state is unchanged.'); });
    ui['remote-commit'].addEventListener('click', function () { state.revision += 1; state.conflict = true; state.preview = true; render(); });
    ui.commit.addEventListener('click', function () { if (state.conflict) { announce('Commit blocked by branch revision conflict.'); return; } state.revision += 1; state.job = 'committed'; state.preview = false; render(); announce('C5 commit succeeded at revision ' + state.revision + '.'); });
    ui.rebase.addEventListener('click', function () { state.conflict = false; state.draft = true; state.preview = false; render(); announce('Draft reapplied to revision ' + state.revision + '; preview again before commit.'); });
    ['zoom-in', 'zoom-out', 'reset-view'].forEach(function (id) { ui[id].addEventListener('click', function () { announce(ui[id].textContent + ' applied to the safe derived overlay.'); }); });
    render();
  </script>
</body>
</html>`;

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${String(port)}`);
  if (url.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  if (url.pathname === "/workspace" || url.pathname === "/") {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      "x-content-type-options": "nosniff",
    });
    response.end(html);
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ code: "NOT_FOUND" }));
});

server.listen(port, host);

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
