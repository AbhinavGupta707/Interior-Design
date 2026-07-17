import { createServer } from "node:http";

const host = "127.0.0.1";
const port = Number(process.env.C5_MOCK_EDITOR_PORT ?? "4315");
const branchId = "c5400000-0000-4000-8000-000000000001";

let state;
let previews;

function headHash(revision) {
  return revision.toString(16).padStart(64, "0");
}

function reset() {
  state = {
    branchCreated: false,
    branchId,
    branchName: "Main design",
    headSnapshotSha256: headHash(0),
    history: [],
    revision: 0,
  };
  previews = new Map();
}

reset();

function send(response, status, body, contentType = "application/json; charset=utf-8") {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": contentType,
  });
  response.end(contentType.startsWith("application/json") ? JSON.stringify(body) : body);
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error("Request body too large.");
  }
  return body.length === 0 ? {} : JSON.parse(body);
}

const html = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>C5 reference editor acceptance harness</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #f3f1eb; color: #17211b; }
    * { box-sizing: border-box; }
    body { margin: 0; min-width: 0; }
    button, input, select { font: inherit; }
    button { border: 1px solid #274638; border-radius: .55rem; background: #fff; color: #173526; padding: .6rem .8rem; cursor: pointer; }
    button.primary { background: #173f2c; color: #fff; }
    button:disabled { cursor: not-allowed; opacity: .45; }
    button:focus-visible, input:focus-visible, select:focus-visible, [tabindex]:focus-visible { outline: 3px solid #b45419; outline-offset: 2px; }
    input, select { border: 1px solid #8e9d94; border-radius: .45rem; min-height: 2.5rem; padding: .45rem .55rem; max-width: 100%; }
    header { background: #173f2c; color: #fff; padding: 1rem clamp(1rem, 3vw, 2rem); }
    header p { margin: .25rem 0 0; color: #dce8e0; }
    main { max-width: 1180px; margin: 0 auto; padding: 1rem; min-width: 0; }
    .notice { border-left: 4px solid #b45419; background: #fff7e8; padding: .75rem; margin-bottom: 1rem; }
    .toolbar, .button-row { display: flex; flex-wrap: wrap; gap: .65rem; align-items: end; }
    .toolbar { background: #fff; border: 1px solid #cbd4ce; border-radius: .8rem; padding: .8rem; margin-bottom: 1rem; }
    .field { display: grid; gap: .25rem; min-width: 0; }
    .workspace { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(17rem, .65fr); gap: 1rem; align-items: start; }
    .panel { min-width: 0; background: #fff; border: 1px solid #cbd4ce; border-radius: .8rem; padding: 1rem; box-shadow: 0 2px 9px rgb(20 47 32 / 8%); }
    .panel h2, .panel h3 { margin-top: 0; }
    .plan-wrap { overflow: auto; border: 1px solid #d9dfdb; border-radius: .6rem; background: #fbfcfa; }
    svg { display: block; width: 100%; min-width: 0; height: auto; }
    .element-list { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .75rem; }
    fieldset { border: 1px solid #cbd4ce; border-radius: .6rem; margin: 0 0 .9rem; padding: .8rem; min-width: 0; }
    legend { font-weight: 700; }
    .grid-two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .65rem; }
    aside .grid-two { grid-template-columns: minmax(0, 1fr); }
    .pending { padding-left: 1.25rem; overflow-wrap: anywhere; }
    .status-card { border-radius: .55rem; padding: .7rem; margin-top: .75rem; background: #edf4ef; overflow-wrap: anywhere; }
    .warning { background: #fff3d6; border: 1px solid #d69b2d; }
    .error { background: #ffe9e5; border: 1px solid #b43c2c; }
    .success { background: #e3f5e8; border: 1px solid #36804c; }
    .muted { color: #53635a; }
    [hidden] { display: none !important; }
    @media (max-width: 600px) {
      main { padding: .75rem; }
      .workspace { grid-template-columns: minmax(0, 1fr); }
      .grid-two { grid-template-columns: minmax(0, 1fr); }
      .toolbar > * { flex: 1 1 100%; }
      .toolbar button { width: 100%; }
      .panel { padding: .8rem; }
    }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; } }
  </style>
</head>
<body>
  <header>
    <h1>2D model operation editor</h1>
    <p>Exact integer-millimetre commands on one pinned branch head.</p>
  </header>
  <main>
    <div class="notice" role="note"><strong>Reference harness only.</strong> Mock evidence does not count as producer, database or live-editor proof.</div>
    <section class="toolbar" aria-label="Branch toolbar">
      <label class="field">Persona
        <select id="role-select" aria-label="Editor persona">
          <option value="owner">Owner</option>
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
        </select>
      </label>
      <label class="field">Branch name
        <input id="branch-name" value="Main design" maxlength="80">
      </label>
      <button id="create-branch">Create branch</button>
      <p id="branch-state" role="status" aria-live="polite">Branch not created.</p>
    </section>

    <p id="viewer-note" class="status-card" hidden><strong>Viewer · read only.</strong> History, comparison and the canonical plan remain available; editable controls are removed.</p>

    <div class="workspace">
      <section class="panel" aria-labelledby="plan-title">
        <h2 id="plan-title">Canonical SVG plan</h2>
        <div class="toolbar" aria-label="Plan controls">
          <label class="field">Level
            <select aria-label="Level selector"><option>Synthetic ground level</option><option>Synthetic first level</option></select>
          </label>
          <button aria-label="Zoom in">Zoom in</button>
          <button aria-label="Zoom out">Zoom out</button>
          <button aria-label="Reset pan and zoom">Reset view</button>
        </div>
        <div class="plan-wrap">
          <svg viewBox="0 0 800 540" role="img" aria-labelledby="svg-title svg-description">
            <title id="svg-title">Synthetic ground-level plan</title>
            <desc id="svg-description">Two rooms divided by a selectable partition wall with one door and two windows.</desc>
            <rect x="40" y="40" width="720" height="450" fill="#f7f6f0" stroke="#173f2c" stroke-width="10"/>
            <line x1="490" y1="40" x2="490" y2="490" stroke="#173f2c" stroke-width="10"/>
            <line x1="490" y1="330" x2="490" y2="400" stroke="#f7f6f0" stroke-width="14"/>
            <text x="205" y="250" font-size="28">Living room</text><text x="570" y="250" font-size="28">Kitchen</text>
          </svg>
        </div>
        <nav class="element-list" aria-label="Focusable model elements">
          <button id="select-wall" aria-pressed="true">Ground partition wall</button>
          <button>Living room</button><button>Ground door opening</button>
        </nav>
        <p class="muted">Stable element ID: <code>a4000000-0000-4000-8000-000000000033</code></p>
      </section>

      <aside class="panel" aria-labelledby="inspector-title">
        <h2 id="inspector-title">Structured inspector</h2>
        <div id="edit-region">
          <fieldset>
            <legend>Translate selected wall</legend>
            <div class="grid-two">
              <label class="field">X translation (mm)<input id="wall-x" type="number" step="1" value="50"></label>
              <label class="field">Y translation (mm)<input id="wall-y" type="number" step="1" value="0"></label>
            </div>
            <button id="add-wall" class="primary">Add wall move</button>
          </fieldset>
          <fieldset>
            <legend>Insert opening</legend>
            <div class="grid-two">
              <label class="field">Offset along wall (mm)<input id="opening-offset" type="number" step="1" value="3500"></label>
              <label class="field">Opening width (mm)<input id="opening-width" type="number" step="1" value="800"></label>
            </div>
            <button id="add-opening" class="primary">Add opening insertion</button>
          </fieldset>
          <fieldset>
            <legend>Rename room</legend>
            <label class="field">Room name<input id="room-name" value="Living room revised" maxlength="160"></label>
            <button id="add-rename" class="primary">Add room rename</button>
          </fieldset>
        </div>

        <section aria-labelledby="pending-title">
          <h3 id="pending-title">Pending commands (<span id="pending-count">0</span>)</h3>
          <ol id="pending-list" class="pending"><li class="muted">No pending commands.</li></ol>
          <div id="pending-actions" class="button-row">
            <button id="undo" disabled>Undo pending command</button>
            <button id="redo" disabled>Redo pending command</button>
            <button id="discard" disabled>Discard pending commands</button>
          </div>
        </section>

        <section id="preview-region" aria-labelledby="preview-title">
          <h3 id="preview-title">Validate and commit</h3>
          <label class="field">Evaluation finding scenario
            <select id="preview-mode"><option value="safe">No finding</option><option value="warning">Warning</option><option value="error">Blocking error</option></select>
          </label>
          <div class="button-row">
            <button id="preview" class="primary" disabled>Preview pending commands</button>
            <button id="commit" disabled>Commit exact preview</button>
          </div>
          <div id="finding" role="status" aria-live="polite"></div>
          <label id="warning-ack-wrap" hidden><input id="warning-ack" type="checkbox"> I acknowledge the warning and known limitation.</label>
        </section>

        <section aria-labelledby="history-title">
          <h3 id="history-title">History and recovery</h3>
          <div class="button-row">
            <button id="compare">Compare branch head</button>
            <button id="restore">Restore source as new history</button>
            <button id="remote-commit">Simulate second-session commit</button>
          </div>
          <div id="history-output" role="status" aria-live="polite" class="status-card">No committed history.</div>
        </section>
        <section id="conflict" class="status-card error" role="alert" hidden>
          <strong>Branch revision conflict.</strong>
          <p id="conflict-detail"></p>
          <p>Your pending typed intent is preserved.</p>
          <div class="button-row"><button id="reload-current">Reload current</button><button id="compare-conflict">Compare</button><button id="reapply">Reapply and repreview</button></div>
        </section>
        <p id="announcer" role="status" aria-live="polite"></p>
      </aside>
    </div>
  </main>
  <script>
    const ui = Object.fromEntries(Array.from(document.querySelectorAll('[id]')).map(function (element) { return [element.id, element]; }));
    let pending = [];
    let redo = [];
    let preview = null;
    let localRevision = 0;
    let localHead = '0'.repeat(64);
    let role = 'owner';

    async function api(path, method, body) {
      const response = await fetch(path, { method: method || 'GET', headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await response.text();
      return { ok: response.ok, status: response.status, body: text ? JSON.parse(text) : undefined };
    }

    function commandLabel(command) {
      if (command.type === 'wall.translate.v1') return 'Move wall by ' + command.xMm + ' mm X and ' + command.yMm + ' mm Y';
      if (command.type === 'opening.insert.v1') return 'Insert ' + command.widthMm + ' mm opening at ' + command.offsetMm + ' mm';
      return 'Rename room to “' + command.name + '”';
    }

    function invalidatePreview() {
      preview = null;
      ui.finding.replaceChildren();
      ui['warning-ack-wrap'].hidden = true;
      ui['warning-ack'].checked = false;
      ui.commit.disabled = true;
    }

    function renderPending() {
      ui['pending-count'].textContent = String(pending.length);
      ui['pending-list'].replaceChildren();
      if (pending.length === 0) {
        const empty = document.createElement('li'); empty.className = 'muted'; empty.textContent = 'No pending commands.'; ui['pending-list'].append(empty);
      } else {
        pending.forEach(function (command) { const item = document.createElement('li'); item.textContent = commandLabel(command); ui['pending-list'].append(item); });
      }
      ui.undo.disabled = pending.length === 0 || role === 'viewer';
      ui.redo.disabled = redo.length === 0 || role === 'viewer';
      ui.discard.disabled = pending.length === 0 || role === 'viewer';
      ui.preview.disabled = pending.length === 0 || role === 'viewer';
      invalidatePreview();
    }

    function addCommand(command) { pending.push(command); redo = []; renderPending(); ui.announcer.textContent = commandLabel(command) + ' added.'; }

    async function loadState(preserveIntent) {
      const result = await api('/api/state');
      localRevision = result.body.revision;
      localHead = result.body.headSnapshotSha256;
      ui['branch-state'].textContent = result.body.branchCreated ? 'Branch ' + result.body.branchName + ' · revision ' + localRevision + ' · head ' + localHead.slice(0, 10) : 'Branch not created.';
      ui['history-output'].textContent = result.body.history.length ? result.body.history.map(function (entry) { return 'Revision ' + entry.revision + ' · ' + entry.type; }).join(' | ') : 'No committed history.';
      if (!preserveIntent) { pending = []; redo = []; renderPending(); }
    }

    function applyRole() {
      role = ui['role-select'].value;
      const viewer = role === 'viewer';
      ui['viewer-note'].hidden = !viewer;
      ui['edit-region'].hidden = viewer;
      ui['pending-actions'].hidden = viewer;
      ui['preview-region'].hidden = viewer;
      ui['remote-commit'].hidden = viewer;
      ui['restore'].hidden = viewer;
      ui['create-branch'].hidden = viewer;
      renderPending();
    }

    async function requestPreview() {
      const result = await api('/api/previews', 'POST', { expectedRevision: localRevision, expectedHeadSnapshotSha256: localHead, operations: pending, mode: ui['preview-mode'].value });
      if (result.status === 409) return showConflict(result.body);
      preview = result.body;
      const finding = ui.finding;
      finding.replaceChildren();
      finding.className = 'status-card ' + (preview.mode === 'error' ? 'error' : preview.mode === 'warning' ? 'warning' : 'success');
      finding.textContent = preview.mode === 'error' ? 'Error · WALL_PATH_SELF_INTERSECTION · commit blocked.' : preview.mode === 'warning' ? 'Warning · ROOM_BOUNDARY_MISMATCH · acknowledgement required.' : 'No blocking findings. Preview is pinned to revision ' + preview.baseRevision + '.';
      ui['warning-ack-wrap'].hidden = preview.mode !== 'warning';
      ui.commit.disabled = preview.mode !== 'safe';
      ui.announcer.textContent = 'Preview completed with ' + preview.mode + ' status.';
    }

    function showConflict(problem) {
      ui.conflict.hidden = false;
      ui['conflict-detail'].textContent = 'Current revision ' + problem.currentRevision + ' · head ' + problem.currentHeadSnapshotSha256.slice(0, 10) + '.';
      ui.announcer.textContent = 'Commit failed because the branch changed. Pending intent was preserved.';
    }

    ui['create-branch'].addEventListener('click', async function () {
      const result = await api('/api/branches', 'POST', { name: ui['branch-name'].value });
      localRevision = result.body.revision; localHead = result.body.headSnapshotSha256; await loadState(true); ui.announcer.textContent = 'Branch created from the exact source snapshot.';
    });
    ui['role-select'].addEventListener('change', applyRole);
    ui['add-wall'].addEventListener('click', function () { addCommand({ type: 'wall.translate.v1', xMm: Number(ui['wall-x'].value), yMm: Number(ui['wall-y'].value) }); });
    ui['add-opening'].addEventListener('click', function () { addCommand({ type: 'opening.insert.v1', offsetMm: Number(ui['opening-offset'].value), widthMm: Number(ui['opening-width'].value) }); });
    ui['add-rename'].addEventListener('click', function () { addCommand({ type: 'space.rename.v1', name: ui['room-name'].value }); });
    ui.undo.addEventListener('click', function () { if (pending.length) { redo.push(pending.pop()); renderPending(); ui.announcer.textContent = 'Last pending command undone.'; } });
    ui.redo.addEventListener('click', function () { if (redo.length) { pending.push(redo.pop()); renderPending(); ui.announcer.textContent = 'Pending command redone.'; } });
    ui.discard.addEventListener('click', function () { pending = []; redo = []; renderPending(); ui.announcer.textContent = 'Pending session discarded.'; });
    ui.preview.addEventListener('click', requestPreview);
    ui['warning-ack'].addEventListener('change', function () { ui.commit.disabled = !(preview && preview.mode === 'warning' && ui['warning-ack'].checked); });
    ui.commit.addEventListener('click', async function () {
      const result = await api('/api/commits', 'POST', { expectedRevision: localRevision, expectedHeadSnapshotSha256: localHead, previewId: preview.id, warningAcknowledged: ui['warning-ack'].checked });
      if (result.status === 409) return showConflict(result.body);
      localRevision = result.body.revision; localHead = result.body.headSnapshotSha256; pending = []; redo = []; ui.conflict.hidden = true; renderPending(); await loadState(true); ui.announcer.textContent = 'Commit succeeded as immutable revision ' + localRevision + '.'; ui.announcer.tabIndex = -1; ui.announcer.focus();
    });
    ui.compare.addEventListener('click', async function () { const result = await api('/api/compare', 'POST', {}); ui['history-output'].textContent = 'Comparison · ' + result.body.modified + ' modified · ' + result.body.added + ' added · ' + result.body.removed + ' removed · truncated ' + result.body.truncated; });
    ui['compare-conflict'].addEventListener('click', function () { ui.compare.click(); });
    ui.restore.addEventListener('click', async function () { const result = await api('/api/restore', 'POST', { expectedRevision: localRevision, sourceSnapshot: 'source' }); localRevision = result.body.revision; localHead = result.body.headSnapshotSha256; await loadState(true); ui.announcer.textContent = 'Source restored as new immutable revision ' + localRevision + '.'; });
    ui['remote-commit'].addEventListener('click', async function () { const result = await api('/api/remote-commit', 'POST', {}); ui.announcer.textContent = 'Second session committed revision ' + result.body.revision + '; this session remains pinned to revision ' + localRevision + '.'; });
    ui['reload-current'].addEventListener('click', async function () { await loadState(true); ui.conflict.hidden = true; ui.announcer.textContent = 'Current branch loaded; pending intent preserved.'; });
    ui.reapply.addEventListener('click', async function () { await loadState(true); ui.conflict.hidden = true; await requestPreview(); ui.announcer.textContent = 'Pending intent rebuilt and repreviewed on revision ' + localRevision + '.'; });
    document.addEventListener('keydown', function (event) { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) ui.redo.click(); else ui.undo.click(); } });
    applyRole(); loadState(false);
  </script>
</body>
</html>`;

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    if (request.method === "GET" && url.pathname === "/health")
      return send(response, 200, { ok: true });
    if (request.method === "POST" && url.pathname === "/__test/reset") {
      reset();
      return send(response, 204, {});
    }
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/editor")) {
      return send(response, 200, html, "text/html; charset=utf-8");
    }
    if (request.method === "GET" && url.pathname === "/api/state")
      return send(response, 200, state);
    if (request.method === "POST" && url.pathname === "/api/branches") {
      const body = await readJson(request);
      state.branchCreated = true;
      state.branchName = String(body.name || "Main design");
      return send(response, 201, state);
    }
    if (request.method === "POST" && url.pathname === "/api/previews") {
      const body = await readJson(request);
      if (
        body.expectedRevision !== state.revision ||
        body.expectedHeadSnapshotSha256 !== state.headSnapshotSha256
      ) {
        return send(response, 409, {
          code: "BRANCH_REVISION_CONFLICT",
          currentRevision: state.revision,
          currentHeadSnapshotSha256: state.headSnapshotSha256,
        });
      }
      const id = `c5410000-0000-4000-8000-${(previews.size + 1).toString(16).padStart(12, "0")}`;
      const preview = {
        id,
        baseRevision: state.revision,
        baseHeadSnapshotSha256: state.headSnapshotSha256,
        mode: body.mode,
        operations: body.operations,
      };
      previews.set(id, preview);
      return send(response, 200, preview);
    }
    if (request.method === "POST" && url.pathname === "/api/commits") {
      const body = await readJson(request);
      if (
        body.expectedRevision !== state.revision ||
        body.expectedHeadSnapshotSha256 !== state.headSnapshotSha256
      ) {
        return send(response, 409, {
          code: "BRANCH_REVISION_CONFLICT",
          currentRevision: state.revision,
          currentHeadSnapshotSha256: state.headSnapshotSha256,
        });
      }
      const preview = previews.get(body.previewId);
      if (!preview) return send(response, 404, { code: "PREVIEW_NOT_FOUND" });
      if (preview.mode === "error") return send(response, 422, { code: "BLOCKING_FINDINGS" });
      state.revision += 1;
      state.headSnapshotSha256 = headHash(state.revision);
      state.history.unshift({
        revision: state.revision,
        type: "typed-operation-commit",
        operationCount: preview.operations.length,
      });
      return send(response, 201, state);
    }
    if (request.method === "POST" && url.pathname === "/api/remote-commit") {
      state.revision += 1;
      state.headSnapshotSha256 = headHash(state.revision);
      state.history.unshift({
        revision: state.revision,
        type: "second-session-commit",
        operationCount: 1,
      });
      return send(response, 201, state);
    }
    if (request.method === "POST" && url.pathname === "/api/compare") {
      return send(response, 200, {
        added: 0,
        modified: state.revision === 0 ? 0 : 1,
        removed: 0,
        truncated: false,
      });
    }
    if (request.method === "POST" && url.pathname === "/api/restore") {
      state.revision += 1;
      state.headSnapshotSha256 = headHash(0);
      state.history.unshift({
        revision: state.revision,
        type: "snapshot.restore.v1",
        operationCount: 1,
      });
      return send(response, 201, state);
    }
    return send(response, 404, { code: "NOT_FOUND" });
  } catch (error) {
    return send(response, 500, {
      code: "MOCK_FAILURE",
      detail: error instanceof Error ? error.message : "unknown",
    });
  }
});

server.listen(port, host, () =>
  process.stdout.write(`C5 mock editor listening on http://${host}:${port}\n`),
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
