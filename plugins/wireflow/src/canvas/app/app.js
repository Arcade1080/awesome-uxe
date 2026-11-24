// Wireflow Studio – Canvas-App. Ohne Build und ohne Abhängigkeiten.
// Screens sind echter Code: Jede Änderung hier geht als Operation an den Server, der das
// Screen-Modul (TSX) umschreibt. Claude arbeitet an denselben Dateien; Änderungen kommen
// per Server-Sent Events zurück und erscheinen sofort.

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false));

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

const KLABEL = { belegt: 'belegt', hinweis: 'Hinweis', annahme: 'Annahme', offen: 'offen', widerspruch: 'Widerspruch' };
const KORDER = ['belegt', 'hinweis', 'annahme', 'offen', 'widerspruch'];
const D = 140; // Kantenlänge der Entscheidungs-Raute
const PROTO = '__proto__';

const S = {
  data: null,
  dataV: 0,
  client: Math.random().toString(36).slice(2, 12),
  mode: 'design',
  fid: 'hifi',
  flowId: null,
  sel: { node: null, el: null, edge: null },
  leftTab: 'layers',
  compQuery: '',
  view: { x: 60, y: 90, k: 0.5 },
  fitted: false,
  frames: new Map(),
  nodeEls: new Map(),
  hover: null,
  drag: null,
  proto: { flowId: null, node: null, history: [], vars: {} },
  protoDom: null,
};

// ---------- Zugriff ----------
const flow = () => S.data?.flows.find(f => f.id === S.flowId) || null;
const nodeById = id => flow()?.nodes.find(n => n.id === id) || null;
const nodeName = id => { const n = nodeById(id); return n ? n.title || n.label || n.id : id; };
const screenOf = n => (n && n.type === 'screen' ? S.data.screens[n.ref] || null : null);
const spec = name => S.data.ds.components.find(c => c.name === name) || null;
const VW = () => S.data?.project.renderer?.viewport?.width || 360;
const VH = () => S.data?.project.renderer?.viewport?.height || 740;
const isContainer = n => { const s = spec(n.name); return s ? s.props?.children?.type === 'node' : n.children.length > 0; };

function findEl(tree, id, parent = null) {
  if (!tree || !id) return null;
  if (tree.id === id) return { node: tree, parent };
  for (const c of tree.children) {
    const r = findEl(c, id, tree);
    if (r) return r;
  }
  return null;
}
function walkTree(n, fn, depth = 0, parent = null) {
  fn(n, depth, parent);
  n.children.forEach(c => walkTree(c, fn, depth + 1, n));
}

// ---------- Server ----------
async function api(url, body) {
  const headers = { 'X-WF-Client': S.client };
  const init = body === undefined ? { headers } : { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const r = await fetch(url, init);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `${r.status} ${r.statusText}`);
  return d;
}
async function screenOp(ref, o) {
  try {
    const r = await api('/api/op', { ref, ...o });
    scheduleReload(r.files || [], r.v);
    return r;
  } catch (e) {
    toast(e.message, 'bad');
    return null;
  }
}
async function flowOp(o) {
  try {
    const r = await api('/api/flow', { flow: S.flowId, ...o });
    scheduleReload(r.files || [], r.v);
    if (r.hinweis) toast(r.hinweis, 'warn');
    return r;
  } catch (e) {
    toast(e.message, 'bad');
    return null;
  }
}
async function undo() {
  try {
    const r = await api('/api/undo', {});
    if (!r.file) toast('Nichts zum Rückgängigmachen.');
    else { toast(`Rückgängig: ${r.file.replace(/^\.wireflow\//, '')}`); scheduleReload(r.files || [], r.v); }
  } catch (e) {
    toast(e.message, 'bad');
  }
}

const pend = new Set();
let reloadTimer = 0;
let reloading = null;
function scheduleReload(files = [], v = 0) {
  if (v && v <= S.dataV && !files.length) return;
  files.forEach(f => pend.add(f));
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(doReload, 25);
}
async function doReload() {
  if (reloading) await reloading;
  if (!pend.size && S.data) {
    // nichts Neues – trotzdem Stand holen
  }
  const files = [...pend];
  pend.clear();
  reloading = (async () => {
    const d = await api('/api/project');
    if (d.v < S.dataV) return;
    S.data = d;
    S.dataV = d.v;
    invalidate(files, d.v);
    if (!flow()) S.flowId = d.flows[0]?.id || null;
    validateSelection();
    renderAll();
  })().catch(e => toast(e.message, 'bad')).finally(() => { reloading = null; });
  await reloading;
}
function invalidate(files, v) {
  let all = false;
  const refs = new Set();
  for (const f of files) {
    const m = /^\.wireflow\/(screens\/[^/]+?)\.(screen|stories)\.tsx$/.exec(f);
    if (m) refs.add(`${m[1]}.screen.tsx`);
    else if (/^\.wireflow\/(flows|journeys|knowledge|decisions|research|ds\/patterns)\//.test(f) || /\.(md|gitkeep)$/.test(f)) continue;
    else all = true;
  }
  for (const fr of S.frames.values()) if (all || refs.has(fr.ref)) fr.v = v;
}

function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('hello', () => setLive(true));
  es.addEventListener('change', e => {
    const d = JSON.parse(e.data);
    if (d.by !== S.client) external(d.files || []);
    scheduleReload(d.files || [], d.v);
  });
  es.onopen = () => setLive(true);
  es.onerror = () => setLive(false);
}
function setLive(on) {
  const p = $('#live');
  p.classList.toggle('off', !on);
  p.querySelector('span').textContent = on ? 'Live' : 'Getrennt';
  p.title = on ? 'Änderungen von Claude und im Editor erscheinen sofort.' : 'Keine Verbindung – läuft der Canvas noch? Link aus Claude Code neu öffnen.';
}
function external(files) {
  const shown = files.map(f => f.replace(/^\.wireflow\//, ''));
  if (!shown.length) return;
  toast(`Geändert von Claude oder im Editor: ${shown.slice(0, 2).join(', ')}${shown.length > 2 ? ` +${shown.length - 2}` : ''}`, 'ai');
  for (const n of flow()?.nodes || []) {
    if (n.ref && files.some(f => f === `.wireflow/${n.ref}` || f === `.wireflow/${n.ref.replace(/\.screen\.tsx$/, '.stories.tsx')}`)) flashNode(n.id);
  }
}
function flashNode(id) {
  const el = S.nodeEls.get(id);
  if (!el) return;
  el.classList.remove('hl');
  void el.offsetWidth;
  el.classList.add('hl');
  setTimeout(() => el.classList.remove('hl'), 2600);
}

let selTimer = 0;
function syncSelection() {
  clearTimeout(selTimer);
  selTimer = setTimeout(() => {
    const n = nodeById(S.sel.node);
    const scr = screenOf(n);
    const el = scr && S.sel.el ? findEl(scr.tree, S.sel.el)?.node : null;
    const e = S.sel.edge != null ? flow()?.edges[S.sel.edge] : null;
    const selection = {
      flow: S.flowId,
      modus: S.mode,
      knoten: n?.id || null,
      titel: n ? n.title || n.label || null : null,
      screen: n?.ref || null,
      zustand: n?.story || (scr?.stories?.[0] ?? null),
      element: el?.id || null,
      komponente: el?.name || null,
      verbindung: e ? { von: e.from, element: e.el || null, nach: e.to, label: e.label || null } : null,
    };
    api('/api/selection', { selection }).catch(() => {});
  }, 250);
}

// ---------- Auswahl ----------
function select(sel) {
  S.sel = { node: sel.node ?? null, el: sel.el ?? null, edge: sel.edge ?? null };
  if (S.mode === 'design') renderCanvas();
  renderLeft();
  renderRight();
  syncSelection();
}
function validateSelection() {
  const f = flow();
  if (!f) { S.sel = { node: null, el: null, edge: null }; return; }
  if (S.sel.edge != null && !f.edges[S.sel.edge]) S.sel.edge = null;
  const n = nodeById(S.sel.node);
  if (!n) { S.sel.node = null; S.sel.el = null; return; }
  const scr = screenOf(n);
  if (S.sel.el && !(scr?.tree && findEl(scr.tree, S.sel.el))) S.sel.el = null;
}
function selectParent() {
  if (S.sel.el) {
    const scr = screenOf(nodeById(S.sel.node));
    const hit = scr && findEl(scr.tree, S.sel.el);
    select(hit?.parent ? { node: S.sel.node, el: hit.parent.id } : { node: S.sel.node });
  } else select({});
}
function selected() {
  const n = nodeById(S.sel.node);
  const scr = screenOf(n);
  const hit = scr && S.sel.el ? findEl(scr.tree, S.sel.el) : null;
  return { n, scr, hit, isRoot: !!(hit && !hit.parent) };
}
async function removeSelected() {
  const { n, hit, isRoot } = selected();
  if (!hit || isRoot) return;
  const r = await screenOp(n.ref, { op: 'remove', id: hit.node.id });
  if (r) select({ node: n.id, el: hit.parent?.id || null });
}
async function duplicateSelected() {
  const { n, hit, isRoot } = selected();
  if (!hit || isRoot) return;
  const r = await screenOp(n.ref, { op: 'duplicate', id: hit.node.id });
  if (r?.selected) select({ node: n.id, el: r.selected });
}
async function moveSelected(delta) {
  const { n, hit, isRoot } = selected();
  if (!hit || isRoot) return;
  const sibs = hit.parent.children;
  const i = sibs.indexOf(hit.node);
  if (i + delta < 0 || i + delta >= sibs.length) return;
  await screenOp(n.ref, { op: 'move', id: hit.node.id, delta });
}

// ---------- Canvas: Ansicht ----------
const stage = $('#stage');
const world = $('#world');
const edgesSvg = $('#edges');
const labelsEl = $('#labels');

function applyView() {
  const { x, y, k } = S.view;
  world.style.transform = `translate(${x}px,${y}px) scale(${k})`;
  world.style.setProperty('--iz', String(1 / k));
  world.classList.toggle('narrow', k < 0.5);
  $('#zoomPct').textContent = `${Math.round(k * 100)} %`;
}
function zoomAt(cx, cy, factor) {
  const r = stage.getBoundingClientRect();
  const px = cx - r.left;
  const py = cy - r.top;
  const k2 = Math.max(0.08, Math.min(2, S.view.k * factor));
  S.view.x = px - ((px - S.view.x) * k2) / S.view.k;
  S.view.y = py - ((py - S.view.y) * k2) / S.view.k;
  S.view.k = k2;
  applyView();
  renderEdges();
}
function zoomCenter(f) {
  const r = stage.getBoundingClientRect();
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, f);
}
function nodeRect(n) {
  const p = S.drag?.kind === 'node' && S.drag.id === n.id ? S.drag.pos : n;
  if (n.type === 'decision') return { x: p.x, y: p.y, w: D, h: D };
  return { x: p.x, y: p.y, w: VW(), h: S.frames.get(n.id)?.h || VH() };
}
function fit() {
  const f = flow();
  if (!f || !f.nodes.length) return;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const n of f.nodes) {
    const r = nodeRect(n);
    x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y); x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h + 30);
  }
  const sr = stage.getBoundingClientRect();
  const k = Math.max(0.08, Math.min(1, Math.min((sr.width - 96) / (x2 - x1), (sr.height - 130) / (y2 - y1))));
  S.view = { k, x: (sr.width - (x2 - x1) * k) / 2 - x1 * k, y: 70 + (sr.height - 100 - (y2 - y1) * k) / 2 - y1 * k };
  applyView();
  renderEdges();
}
function centerOn(id) {
  const n = nodeById(id);
  if (!n) return;
  const r = nodeRect(n);
  const sr = stage.getBoundingClientRect();
  S.view.x = sr.width / 2 - (r.x + r.w / 2) * S.view.k;
  S.view.y = sr.height / 2 - (r.y + Math.min(r.h, 600) / 2) * S.view.k;
  applyView();
}

function beginPointer({ move, up }) {
  const mv = ev => move(ev);
  const u = ev => {
    removeEventListener('pointermove', mv);
    removeEventListener('pointerup', u);
    removeEventListener('pointercancel', u);
    up(ev);
  };
  addEventListener('pointermove', mv);
  addEventListener('pointerup', u);
  addEventListener('pointercancel', u);
}

// ---------- Canvas: Knoten und Frames ----------
function frameUrl(fr) {
  const q = new URLSearchParams({ ref: fr.ref, story: fr.story || '', mode: S.fid, ui: fr.proto ? 'prototype' : 'design', v: String(fr.v) });
  if (fr.proto) q.set('vars', JSON.stringify(S.proto.vars));
  return `/render?${q}`;
}
function ensureIframe(fr) {
  const url = frameUrl(fr);
  if (fr.url === url) return;
  fr.url = url;
  const ifr = h('iframe', { src: url, title: `Screen ${fr.ref}`, tabindex: fr.proto ? '0' : '-1' });
  if (!fr.iframe) {
    fr.iframe = ifr;
    fr.box.insertBefore(ifr, fr.ov || null);
    return;
  }
  if (fr.next) fr.next.remove();
  ifr.classList.add('loading');
  if (!fr.proto) ifr.style.height = `${VH()}px`;
  fr.next = ifr;
  fr.box.insertBefore(ifr, fr.ov || null);
  setTimeout(() => { if (fr.next === ifr) promote(fr); }, 6000);
}
function promote(fr) {
  if (!fr.next) return;
  fr.iframe.remove();
  fr.iframe = fr.next;
  fr.next = null;
  fr.iframe.classList.remove('loading');
  fr.iframe.style.height = '';
}
function frameBySource(src) {
  for (const fr of S.frames.values()) {
    if (fr.iframe?.contentWindow === src) return { fr, current: true };
    if (fr.next?.contentWindow === src) return { fr, current: false };
  }
  return null;
}

function renderCanvas() {
  const f = flow();
  for (const [id, el] of S.nodeEls) {
    if (!f || !f.nodes.some(n => n.id === id)) {
      el.remove();
      S.nodeEls.delete(id);
      S.frames.delete(id);
    }
  }
  let empty = stage.querySelector(':scope > .empty');
  if (!f) {
    if (!empty) stage.append(h('div', { class: 'empty' }, h('div', {}, h('b', {}, 'Noch kein Flow'), 'In Claude Code: /wireflow:flow – oder eine Journey mit /wireflow:journey anlegen.')));
    edgesSvg.innerHTML = '';
    fill(labelsEl, );
    return;
  }
  empty?.remove();
  for (const n of f.nodes) renderNode(n);
  renderEdges();
  renderOverlays();
}

function renderNode(n) {
  let el = S.nodeEls.get(n.id);
  if (el && el.dataset.type !== n.type) {
    el.remove();
    S.nodeEls.delete(n.id);
    S.frames.delete(n.id);
    el = null;
  }
  if (!el) {
    el = n.type === 'decision' ? createDecision(n.id) : createScreen(n.id);
    el.dataset.type = n.type;
    el.dataset.node = n.id;
    world.append(el);
    S.nodeEls.set(n.id, el);
  }
  const p = S.drag?.kind === 'node' && S.drag.id === n.id ? S.drag.pos : n;
  el.style.left = `${p.x}px`;
  el.style.top = `${p.y}px`;
  el.classList.toggle('sel', S.sel.node === n.id && !S.sel.el && S.sel.edge == null);
  el.classList.toggle('entry', flow().entry === n.id);
  if (n.type === 'decision') {
    el.querySelector('.dl').textContent = n.label || n.id;
    el.querySelector('.dv').textContent = n.var ? `${n.var} ?` : '';
  } else updateScreen(n);
}

function createScreen(id) {
  const title = h('div', { class: 'ftitle' });
  const ov = h('div', { class: 'ov' });
  const box = h('div', { class: 'frame' }, ov);
  const el = h('div', { class: 'node scr' }, title, box);
  const fr = { id, ref: '', story: '', v: S.dataV, url: '', iframe: null, next: null, boxes: {}, h: VH(), box, ov, title, failed: false };
  S.frames.set(id, fr);
  title.addEventListener('pointerdown', e => startNodeDrag(e, id));
  ov.addEventListener('pointermove', e => onOvMove(e, fr));
  ov.addEventListener('pointerleave', () => { if (S.hover?.node === id && !S.drag) { S.hover = null; renderOverlays(); } });
  ov.addEventListener('pointerdown', e => onOvDown(e, fr));
  ov.addEventListener('dblclick', () => setTimeout(() => $('#right [data-key$=":#text"]')?.focus(), 30));
  return el;
}
function createDecision(id) {
  const el = h('div', { class: 'node dec' });
  el.innerHTML = '<svg viewBox="0 0 140 140" aria-hidden="true"><polygon points="70,2 138,70 70,138 2,70"/></svg><div class="dl"></div><div class="dv"></div>';
  el.addEventListener('pointerdown', e => startNodeDrag(e, id));
  return el;
}
const kchip = (level, text) => h('span', { class: `kchip k-${level}` }, text || KLABEL[level] || level);

function updateScreen(n) {
  const fr = S.frames.get(n.id);
  fr.ref = n.ref;
  fr.story = n.story || '';
  const scr = S.data.screens[n.ref];
  const k = flow().knowledge?.nodes?.[n.id];
  const l = scr?.lint;
  fill(fr.title, 
    k ? h('i', { class: 'kdot', style: `background:var(--k-${k.level})`, title: `Wissensstand: ${KLABEL[k.level]}` }) : null,
    h('b', {}, n.title || n.id),
    scr?.stories?.length > 1 || n.story ? h('span', { class: 'tag', title: 'Zustand (Story)' }, n.story || scr.stories[0]) : null,
    k ? h('span', { class: `tag k-${k.level}`, title: 'Wissensstand' }, KLABEL[k.level]) : null,
    scr?.error ? h('span', { class: 'tag bad' }, 'Fehler') : l ? (l.errors.length ? h('span', { class: 'tag bad', title: l.errors.map(e => e.msg).join('\n') }, `${l.errors.length} Fehler`) : h('span', { class: `tag ${l.score.pct < 100 ? 'warn' : 'ok'}`, title: 'Anteil der Elemente aus dem Design System' }, `DS ${l.score.pct} %`)) : null,
    fr.failed ? h('span', { class: 'tag bad' }, 'Renderfehler') : null,
  );
  fr.box.style.width = `${VW()}px`;
  fr.box.style.height = `${fr.h}px`;
  ensureIframe(fr);
}

// ---------- Canvas: Kanten ----------
function port(n, side, tx) {
  const r = nodeRect(n);
  if (n.type === 'decision') {
    return { l: { x: r.x, y: r.y + D / 2, nx: -1, ny: 0 }, r: { x: r.x + D, y: r.y + D / 2, nx: 1, ny: 0 }, t: { x: r.x + D / 2, y: r.y, nx: 0, ny: -1 }, b: { x: r.x + D / 2, y: r.y + D, nx: 0, ny: 1 } }[side] || { x: r.x + D, y: r.y + D / 2, nx: 1, ny: 0 };
  }
  const cx = tx ?? r.w / 2;
  const cy = Math.min(r.h / 2, 320);
  return { l: { x: r.x, y: r.y + cy, nx: -1, ny: 0 }, r: { x: r.x + r.w, y: r.y + cy, nx: 1, ny: 0 }, t: { x: r.x + cx, y: r.y, nx: 0, ny: -1 }, b: { x: r.x + cx, y: r.y + r.h, nx: 0, ny: 1 } }[side] || { x: r.x, y: r.y + cy, nx: -1, ny: 0 };
}
const bez = (a, b, c, d, t) => {
  const u = 1 - t;
  return { x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x, y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y };
};
function edgeGeom(e) {
  const a = nodeById(e.from);
  const b = nodeById(e.to);
  if (!a || !b) return null;
  const fr = S.frames.get(a.id);
  let p1;
  if (a.type === 'screen' && e.el && fr?.boxes[e.el]) {
    const r = nodeRect(a);
    const bx = fr.boxes[e.el];
    p1 = { x: r.x + bx[0] + bx[2], y: r.y + bx[1] + bx[3] / 2, nx: 1, ny: 0, dot: true };
  } else p1 = port(a, e.route?.fs || (a.type === 'decision' ? (e.when === 'else' ? 'b' : 'r') : 'r'));
  const p2 = port(b, e.route?.ts || 'l', e.route?.tx);
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const k1 = e.route?.k?.[0] ?? Math.max(40, Math.min(180, dist * 0.4));
  const k2 = e.route?.k?.[1] ?? k1;
  const c1 = { x: p1.x + p1.nx * k1, y: p1.y + p1.ny * k1 };
  const c2 = { x: p2.x + p2.nx * k2, y: p2.y + p2.ny * k2 };
  return { d: `M${p1.x},${p1.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`, p1, p2, c1, c2, mid: bez(p1, c1, c2, p2, 0.5) };
}
function arrowHead(g, iz, cls) {
  let ux = g.p2.x - g.c2.x;
  let uy = g.p2.y - g.c2.y;
  const len = Math.hypot(ux, uy) || 1;
  ux /= len; uy /= len;
  const s = 9 * iz;
  const bx = g.p2.x - ux * s;
  const by = g.p2.y - uy * s;
  return `<polygon class="ah ${cls}" points="${g.p2.x},${g.p2.y} ${bx - uy * s * 0.5},${by + ux * s * 0.5} ${bx + uy * s * 0.5},${by - ux * s * 0.5}"/>`;
}
function renderEdges() {
  const f = flow();
  if (!f || S.mode !== 'design') { if (!f) { edgesSvg.innerHTML = ''; fill(labelsEl, ); } return; }
  const iz = 1 / S.view.k;
  let svg = '';
  const labels = [];
  const twins = new Map();
  f.edges.forEach(e => { const k = `${e.from}|${e.to}`; twins.set(k, (twins.get(k) || 0) + 1); });
  const seen = new Map();
  f.edges.forEach((e, i) => {
    const g = edgeGeom(e);
    if (!g) return;
    const tk = `${e.from}|${e.to}`;
    const cnt = twins.get(tk);
    if (cnt > 1) {
      const r = seen.get(tk) || 0;
      seen.set(tk, r + 1);
      g.mid = bez(g.p1, g.c1, g.c2, g.p2, 0.5 + 0.22 * (r - (cnt - 1) / 2));
    }
    const cls = `${S.sel.edge === i ? 'sel' : ''} ${e.when === 'else' ? 'no' : e.when ? 'yes' : ''}`.trim();
    svg += `<path class="${cls}" d="${g.d}"/>${arrowHead(g, iz, cls)}`;
    if (g.p1.dot) svg += `<circle cx="${g.p1.x}" cy="${g.p1.y}" r="${4 * iz}"/>`;
    const set = e.set ? Object.entries(e.set).map(([k, v]) => `${k}=${v}`).join(' ') : '';
    labels.push(h('div', { class: `elabel${S.sel.edge === i ? ' sel' : ''}`, style: `left:${g.mid.x}px;top:${g.mid.y}px`, title: `${nodeName(e.from)} → ${nodeName(e.to)}`, onpointerdown: ev => ev.stopPropagation(), onclick: () => select({ edge: i }) }, e.label || e.el || '→', set ? h('span', { class: 'set' }, ` ${set}`) : null));
  });
  for (const iss of f.issues || []) {
    if (iss.code !== 'decision-no' && iss.code !== 'decision-yes') continue;
    const n = nodeById(iss.ref);
    if (!n) continue;
    const p = port(n, iss.code === 'decision-no' ? 'b' : 'r');
    const q = { x: p.x + p.nx * 150, y: p.y + p.ny * 150 };
    svg += `<path class="miss" d="M${p.x},${p.y} L${q.x},${q.y}"/>`;
    labels.push(h('div', { class: 'elabel miss', style: `left:${q.x}px;top:${q.y}px`, title: iss.message, onpointerdown: ev => ev.stopPropagation(), onclick: () => select({ node: n.id }) }, iss.code === 'decision-no' ? 'Nein-Pfad fehlt' : 'Ja-Pfad fehlt'));
  }
  edgesSvg.innerHTML = svg;
  fill(labelsEl, ...labels);
}

// ---------- Canvas: Auswahl, Hover, Einfügen ----------
function localPos(e, fr) {
  const r = fr.ov.getBoundingClientRect();
  const s = r.width / VW();
  return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
}
function hitTest(fr, x, y) {
  let best = null;
  let area = Infinity;
  for (const [id, b] of Object.entries(fr.boxes)) {
    if (x >= b[0] && x <= b[0] + b[2] && y >= b[1] && y <= b[1] + b[3] && b[2] * b[3] <= area) { best = id; area = b[2] * b[3]; }
  }
  return best;
}
function onOvMove(e, fr) {
  if (S.drag) return;
  const p = localPos(e, fr);
  const id = hitTest(fr, p.x, p.y);
  if (S.hover?.node !== fr.id || S.hover?.el !== id) {
    S.hover = { node: fr.id, el: id };
    renderOverlays();
  }
}
function onOvDown(e, fr) {
  if (e.button !== 0) return;
  e.stopPropagation();
  const p = localPos(e, fr);
  const id = hitTest(fr, p.x, p.y);
  if (!id) { select({ node: fr.id }); return; }
  select({ node: fr.id, el: id });
  const scr = S.data.screens[fr.ref];
  if (!scr?.tree || id === scr.tree.id) return;
  const start = { x: e.clientX, y: e.clientY };
  beginPointer({
    move: ev => {
      if (!S.drag && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
      if (!S.drag) S.drag = { kind: 'move', id, node: fr.id, label: findEl(scr.tree, id)?.node.name || id };
      dragOver(ev);
    },
    up: () => { if (S.drag?.kind === 'move') finishDrop(); },
  });
}
function startCompDrag(e, name) {
  e.preventDefault();
  const start = { x: e.clientX, y: e.clientY };
  beginPointer({
    move: ev => {
      if (!S.drag && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
      if (!S.drag) S.drag = { kind: 'insert', component: name, label: name };
      dragOver(ev);
    },
    up: () => { if (S.drag?.kind === 'insert') finishDrop(); },
  });
}
function dragOver(ev) {
  const g = $('#ghost');
  g.hidden = false;
  g.textContent = S.drag.kind === 'move' ? `${S.drag.label} verschieben` : `${S.drag.label} einfügen`;
  g.style.left = `${ev.clientX}px`;
  g.style.top = `${ev.clientY}px`;
  const ov = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.ov');
  let target = null;
  if (ov) {
    const id = ov.closest('.node')?.dataset.node;
    const fr = S.frames.get(id);
    if (fr && (S.drag.kind === 'insert' || id === S.drag.node)) {
      const p = localPos(ev, fr);
      target = dropTarget(fr, p.x, p.y, S.drag.kind === 'move' ? S.drag.id : null);
      if (target) target.node = id;
    }
  }
  S.drag.target = target;
  renderOverlays();
}
async function finishDrop() {
  const d = S.drag;
  S.drag = null;
  $('#ghost').hidden = true;
  renderOverlays();
  const t = d?.target;
  if (!t || t.noop) return;
  const fr = S.frames.get(t.node);
  if (d.kind === 'insert') {
    const r = await screenOp(fr.ref, { op: 'insert', component: d.component, parent: t.parent, index: t.index });
    if (r?.selected) select({ node: t.node, el: r.selected });
  } else {
    const r = await screenOp(fr.ref, { op: 'move', id: d.id, parent: t.parent, index: t.index });
    if (r) select({ node: t.node, el: d.id });
  }
}
// Wohin fällt ein Element? Tiefster Container unter dem Zeiger, Position nach Lage der Geschwister.
function dropTarget(fr, x, y, movingId) {
  const scr = S.data.screens[fr.ref];
  if (!scr?.tree) return null;
  const banned = new Set();
  if (movingId) { const m = findEl(scr.tree, movingId); if (m) walkTree(m.node, k => banned.add(k.id)); }
  let c = null;
  walkTree(scr.tree, (n, depth) => {
    const b = fr.boxes[n.id];
    if (!n.id || banned.has(n.id) || !b || !isContainer(n)) return;
    if (x >= b[0] && x <= b[0] + b[2] && y >= b[1] && y <= b[1] + b[3] && (!c || depth >= c.depth)) c = { n, depth, b };
  });
  if (!c) {
    if (!isContainer(scr.tree)) return null;
    c = { n: scr.tree, depth: 0, b: fr.boxes[scr.tree.id] || [0, 0, VW(), fr.h] };
  }
  const all = c.n.children.filter(k => k.id !== movingId);
  const kids = all.filter(k => fr.boxes[k.id]);
  const B = k => fr.boxes[k.id];
  const horizontal = kids.length > 1 && Math.abs(B(kids[0])[1] - B(kids[1])[1]) < 4 && B(kids[1])[0] > B(kids[0])[0] + 4;
  let i = 0;
  for (const k of kids) { const b = B(k); if (horizontal ? b[0] + b[2] / 2 < x : b[1] + b[3] / 2 < y) i++; }
  const index = i < kids.length ? all.indexOf(kids[i]) : all.length;
  const cb = c.b;
  let line;
  if (horizontal) {
    const lx = i === 0 ? B(kids[0])[0] - 3 : i >= kids.length ? B(kids[kids.length - 1])[0] + B(kids[kids.length - 1])[2] + 3 : (B(kids[i - 1])[0] + B(kids[i - 1])[2] + B(kids[i])[0]) / 2;
    line = { x: lx, y: cb[1] + 4, w: 0, h: cb[3] - 8 };
  } else {
    const ly = !kids.length ? cb[1] + 8 : i === 0 ? B(kids[0])[1] - 3 : i >= kids.length ? B(kids[kids.length - 1])[1] + B(kids[kids.length - 1])[3] + 3 : (B(kids[i - 1])[1] + B(kids[i - 1])[3] + B(kids[i])[1]) / 2;
    line = { x: cb[0] + 6, y: ly, w: cb[2] - 12, h: 0 };
  }
  let noop = false;
  if (movingId) {
    const cur = findEl(scr.tree, movingId);
    noop = cur?.parent === c.n && c.n.children.indexOf(cur.node) === index;
  }
  return { parent: c.n.id, index, line, noop, label: c.n.name };
}
function renderOverlays() {
  for (const fr of S.frames.values()) {
    if (!fr.ov) continue;
    const kids = [];
    if (fr.h > VH() + 2) kids.push(h('div', { class: 'fold', style: `top:${VH()}px` }, h('span', {}, `Sichtbereich ${VH()} px`)));
    const box = (id, cls, label) => {
      const b = fr.boxes[id];
      if (!b) return null;
      return h('div', { class: cls, style: `left:${b[0]}px;top:${b[1]}px;width:${b[2]}px;height:${b[3]}px` }, label ? h('span', {}, label) : null);
    };
    if (S.hover?.node === fr.id && S.hover.el && S.hover.el !== S.sel.el && !S.drag) kids.push(box(S.hover.el, 'hb'));
    if (S.sel.node === fr.id && S.sel.el && S.drag?.kind !== 'move') {
      const scr = S.data.screens[fr.ref];
      kids.push(box(S.sel.el, 'sb', findEl(scr?.tree, S.sel.el)?.node.name));
    }
    const t = S.drag?.target;
    if (t && t.node === fr.id) {
      const l = t.line;
      kids.push(h('div', { class: 'ins', style: l.h ? `left:${l.x}px;top:${l.y}px;height:${l.h}px;width:0;border-top:0;border-left:calc(2px*var(--iz)) solid var(--sel)` : `left:${l.x}px;top:${l.y}px;width:${l.w}px` }));
      kids.push(box(t.parent, 'hb'));
    }
    fill(fr.ov, ...kids.filter(Boolean));
  }
}

// Knoten verschieben (am Titel bzw. an der Raute ziehen)
function startNodeDrag(e, id) {
  if (e.button !== 0) return;
  e.stopPropagation();
  e.preventDefault();
  const n = nodeById(id);
  if (!n) return;
  select({ node: id });
  const k = S.view.k;
  const start = { x: e.clientX, y: e.clientY, nx: n.x, ny: n.y };
  let moved = false;
  beginPointer({
    move: ev => {
      const dx = (ev.clientX - start.x) / k;
      const dy = (ev.clientY - start.y) / k;
      if (!moved && Math.hypot(dx * k, dy * k) < 4) return;
      moved = true;
      S.drag = { kind: 'node', id, pos: { x: Math.round((start.nx + dx) / 10) * 10, y: Math.round((start.ny + dy) / 10) * 10 } };
      const el = S.nodeEls.get(id);
      el.style.left = `${S.drag.pos.x}px`;
      el.style.top = `${S.drag.pos.y}px`;
      renderEdges();
    },
    up: async () => {
      const d = S.drag;
      S.drag = null;
      if (moved && d) {
        n.x = d.pos.x;
        n.y = d.pos.y;
        renderEdges();
        await flowOp({ op: 'moveNode', id, x: d.pos.x, y: d.pos.y });
      }
    },
  });
}

stage.addEventListener('pointerdown', e => {
  if (S.mode !== 'design' || (e.button !== 0 && e.button !== 1)) return;
  if (e.target.closest('.node,.elabel,.zoom')) return;
  const start = { x: e.clientX, y: e.clientY, vx: S.view.x, vy: S.view.y };
  let moved = false;
  stage.classList.add('panning');
  beginPointer({
    move: ev => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      S.view.x = start.vx + dx;
      S.view.y = start.vy + dy;
      applyView();
    },
    up: () => {
      stage.classList.remove('panning');
      if (!moved) select({});
    },
  });
});
stage.addEventListener('wheel', e => {
  if (S.mode !== 'design') return;
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
  else {
    S.view.x -= e.deltaX;
    S.view.y -= e.deltaY;
    applyView();
  }
}, { passive: false });
$('#zoom').addEventListener('click', e => {
  const z = e.target.closest('button')?.dataset.z;
  if (z === '+') zoomCenter(1.25);
  else if (z === '-') zoomCenter(0.8);
  else if (z === 'fit') fit();
});

// Nachrichten aus den gerenderten Screens
addEventListener('message', e => {
  if (e.origin !== location.origin || !e.data || e.data.wf !== 1) return;
  const hit = frameBySource(e.source);
  if (!hit) return;
  const { fr } = hit;
  const d = e.data;
  if (d.type === 'ready' || d.type === 'layout') {
    if (!hit.current) {
      if (d.type !== 'ready') return;
      promote(fr);
    }
    fr.boxes = d.boxes || {};
    fr.failed = !!d.failed;
    if (!fr.proto) {
      const nh = Math.max(VH(), Math.min(Math.round(d.height || 0), 6000));
      if (nh !== fr.h) { fr.h = nh; fr.box.style.height = `${nh}px`; }
      renderEdges();
      renderOverlays();
      const n = nodeById(fr.id);
      if (n && d.failed) updateScreen(n);
    } else {
      fr.iframe.contentWindow.postMessage({ wf: 1, type: 'hotspots', ids: (flow()?.edges || []).filter(x => x.from === S.proto.node && x.el).map(x => x.el) }, location.origin);
    }
  }
  if (d.type === 'error' && hit.current && !fr.proto) {
    fr.failed = true;
    const n = nodeById(fr.id);
    if (n) updateScreen(n);
  }
  if (fr.proto && hit.current) {
    if (d.type === 'trigger') protoTrigger(d.el);
    if (d.type === 'back') protoBack();
  }
});

// ---------- Linke Spalte ----------
function tabs(list, current, onPick) {
  return h('div', { class: 'tabs', role: 'tablist' }, ...list.map(([id, label]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(id === current), onclick: () => onPick(id) }, label)));
}
function renderLeft() {
  const L = $('#left');
  if (!S.data) return;
  if (S.mode === 'prototype') { fill(L, protoLeft()); return; }
  const pane = h('div', { class: 'pane' });
  const t = tabs([['layers', 'Ebenen'], ['components', 'Komponenten'], ['patterns', 'Patterns'], ['tokens', 'Tokens']], S.leftTab, id => { S.leftTab = id; renderLeft(); });
  ({ layers: layersPane, components: componentsPane, patterns: patternsPane, tokens: tokensPane })[S.leftTab](pane);
  fill(L, t, pane);
}
function layersPane(pane) {
  const f = flow();
  if (!f) { pane.append(h('p', { class: 'hint' }, 'Kein Flow.')); return; }
  const n = nodeById(S.sel.node);
  const scr = screenOf(n);
  if (scr?.tree) {
    pane.append(h('div', { class: 'grp' }, n.title || n.id, h('em', {}, scr.component || '')));
    const warn = new Set([...scr.lint.warnings, ...scr.lint.errors].map(w => w.el).filter(Boolean));
    const items = [];
    walkTree(scr.tree, (el, depth) => {
      const sp = spec(el.name);
      items.push(h('li', {}, h('button', {
        type: 'button',
        'aria-current': String(S.sel.el === el.id),
        style: `padding-left:${6 + depth * 14}px`,
        onclick: () => select({ node: n.id, el: el.id }),
        onmouseenter: () => { S.hover = { node: n.id, el: el.id }; renderOverlays(); },
        onmouseleave: () => { S.hover = null; renderOverlays(); },
      }, h('span', { class: 'ico' }, !sp ? '!' : isContainer(el) ? '▤' : '◇'), h('span', { class: `nm${sp ? '' : ' gap'}`, title: sp ? '' : 'Keine Komponente des Design Systems' }, el.name), el.text ? h('span', { class: 'tx' }, el.text) : null, h('em', {}, warn.has(el.id) ? '⚠ ' : '', el.id || ''))));
    });
    pane.append(h('ul', { class: 'tree' }, ...items));
    pane.append(h('p', { class: 'hint' }, 'Ziehen auf dem Screen ordnet um. Entf löscht, ⌘/Strg+D dupliziert, Alt+↑/↓ verschiebt.'));
  }
  pane.append(h('div', { class: 'grp' }, 'Flow', h('em', {}, `${f.nodes.length} Knoten`)));
  pane.append(h('ul', { class: 'tree' }, ...f.nodes.map(x => h('li', {}, h('button', {
    type: 'button',
    'aria-current': String(S.sel.node === x.id && !S.sel.el),
    onclick: () => { select({ node: x.id }); centerOn(x.id); },
  }, h('span', { class: 'ico' }, x.type === 'decision' ? '◆' : '▢'), h('span', { class: 'nm' }, x.title || x.label || x.id), f.entry === x.id ? h('em', {}, 'Einstieg') : x.exit ? h('em', {}, 'Ausstieg') : null)))));
}
function insertTarget() {
  const n = nodeById(S.sel.node);
  const scr = screenOf(n);
  if (!scr?.tree) return null;
  const hit = S.sel.el ? findEl(scr.tree, S.sel.el) : null;
  if (hit && isContainer(hit.node)) return { ref: n.ref, node: n.id, parent: hit.node.id, label: hit.node.name };
  if (hit?.parent) return { ref: n.ref, node: n.id, parent: hit.parent.id, index: hit.parent.children.indexOf(hit.node) + 1, label: `nach ${hit.node.name}` };
  return { ref: n.ref, node: n.id, parent: scr.tree.id, label: scr.tree.name };
}
async function insertComponent(name) {
  const t = insertTarget();
  if (!t) { toast('Zuerst einen Screen auswählen – oder die Komponente auf einen Screen ziehen.', 'warn'); return; }
  const r = await screenOp(t.ref, { op: 'insert', component: name, parent: t.parent, index: t.index });
  if (r?.selected) select({ node: t.node, el: r.selected });
}
function componentsPane(pane) {
  const q = h('input', { class: 'search', type: 'search', placeholder: 'Suchen: Name, Zweck, Intent …', 'aria-label': 'Komponente suchen' });
  q.value = S.compQuery;
  const list = h('div');
  const refill = () => {
    const terms = S.compQuery.toLowerCase().split(/\s+/).filter(Boolean);
    const groups = new Map();
    for (const c of S.data.ds.components) {
      const hay = [c.name, c.description, c.category, ...(c.intents || []), ...(c.keywords || [])].join(' ').toLowerCase();
      if (terms.length && !terms.every(t => hay.includes(t))) continue;
      const g = c.category || 'Komponenten';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(c);
    }
    fill(list, ...[...groups].flatMap(([g, cs]) => [h('div', { class: 'grp' }, g), ...cs.map(compItem)]));
    if (!groups.size) list.append(h('p', { class: 'hint' }, 'Nichts gefunden. Fehlt etwas im Design System? Das ist eine DS-Lücke – Claude kann sie dokumentieren.'));
  };
  q.addEventListener('input', () => { S.compQuery = q.value; refill(); });
  refill();
  const t = insertTarget();
  pane.append(
    h('p', { class: 'hint' }, `${S.data.ds.name || 'Design System'} ${S.data.ds.version || ''} · ${S.data.ds.components.length} Komponenten. `, t ? `+ fügt ein in „${t.label}“; ` : '', 'oder auf einen Screen ziehen.'),
    q,
    list,
  );
  if (S.data.ds.gaps?.length) pane.append(h('div', { class: 'gapc' }, h('b', {}, 'Bekannte Lücken'), h('ul', { class: 'guides' }, ...S.data.ds.gaps.map(g => h('li', {}, g.note || g.intent)))));
}
function compItem(c) {
  const el = h('div', { class: 'comp', title: [c.description, ...(c.guidelines || [])].filter(Boolean).join('\n') },
    h('div', { class: 'cn' }, h('b', {}, c.name, ' ', c.status && c.status !== 'stable' ? h('span', { class: `tag ${c.status === 'deprecated' ? 'bad' : 'warn'}` }, c.status) : null), c.description ? h('small', {}, c.description) : null),
    h('button', { type: 'button', class: 'cadd', 'aria-label': `${c.name} einfügen`, onclick: ev => { ev.stopPropagation(); insertComponent(c.name); } }, '+'));
  el.addEventListener('pointerdown', ev => { if (ev.button === 0 && !ev.target.closest('.cadd')) startCompDrag(ev, c.name); });
  return el;
}
function patternsPane(pane) {
  if (!S.data.ds.patterns.length) { pane.append(h('p', { class: 'hint' }, 'Keine Patterns dokumentiert. /wireflow:ds hilft beim Erfassen.')); return; }
  pane.append(h('p', { class: 'hint' }, 'Patterns sagen, wann welche Komponente passt und welche Zustände ein Flow braucht. Claude prüft Screens dagegen.'));
  for (const p of S.data.ds.patterns) {
    pane.append(h('details', { class: 'pat' }, h('summary', {}, p.name, p.status ? h('span', { class: `tag ${p.status === 'stable' ? 'ok' : 'warn'}` }, p.status) : null), h('pre', {}, p.text)));
  }
}
function tokensPane(pane) {
  const groups = new Map();
  for (const t of S.data.ds.tokens) {
    const g = t.path.split('.')[0];
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(t);
  }
  if (!groups.size) pane.append(h('p', { class: 'hint' }, 'Keine Token-Dateien im Manifest.'));
  for (const [g, ts] of groups) {
    pane.append(h('div', { class: 'grp' }, g, h('em', {}, String(ts.length))));
    for (const t of ts) pane.append(h('div', { class: 'tok', title: `${t.path}: ${t.css}` }, t.type === 'color' ? h('span', { class: 'sw', style: `background:${t.css}` }) : null, h('code', {}, t.path), h('small', {}, t.css)));
  }
}

// ---------- Rechte Spalte: Inspector ----------
function keepFocus(root, fn) {
  const a = document.activeElement;
  const key = a && root.contains(a) ? a.dataset.key : null;
  const val = key && 'value' in a ? a.value : null;
  const range = key && typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null;
  fn();
  if (!key) return;
  const b = root.querySelector(`[data-key="${CSS.escape(key)}"]`);
  if (!b) return;
  if (val != null && b.tagName !== 'SELECT' && b.type !== 'checkbox') b.value = val;
  b.focus();
  if (range) { try { b.setSelectionRange(...range); } catch { /* nicht für jedes Feld */ } }
}
const btn = (label, onClick, disabled = false, cls = '') => h('button', { type: 'button', class: `btn ${cls}`, disabled, onclick: onClick }, label);
function msgList(items, empty) {
  if (!items.length) return h('p', { class: 'hint' }, empty || '');
  return h('ul', { class: 'msgs' }, ...items.map(m => h('li', { class: m.level || '', 'data-go': m.go ? '1' : null, onclick: m.go ? () => { select({ node: m.go }); centerOn(m.go); } : null }, m.msg)));
}
function inputRow(label, key, value, commit, placeholder = '') {
  const inp = h('input', { type: 'text', id: key, 'data-key': key, placeholder });
  inp.value = value;
  inp.addEventListener('change', () => commit(inp.value.trim()));
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
  return h('div', { class: 'row' }, h('label', { for: key }, label), inp);
}
function renderRight() {
  const R = $('#right');
  if (!S.data) return;
  keepFocus(R, () => {
    const pane = h('div', { class: 'pane' });
    if (S.mode === 'prototype') protoPanel(pane);
    else {
      const n = nodeById(S.sel.node);
      if (S.sel.edge != null && flow()?.edges[S.sel.edge]) edgeInspector(pane, S.sel.edge);
      else if (n?.type === 'screen' && S.sel.el) elementInspector(pane, n);
      else if (n?.type === 'screen') screenInspector(pane, n);
      else if (n?.type === 'decision') decisionInspector(pane, n);
      else flowInspector(pane);
    }
    fill(R, pane);
  });
}
function literal(p) {
  if (!p) return { ok: true, value: undefined };
  if (p.kind === 'str') return { ok: true, value: p.raw };
  if (p.kind === 'bool') return { ok: true, value: true };
  if (p.kind === 'expr') { try { return { ok: true, value: JSON.parse(p.raw) }; } catch { return { ok: false }; } }
  return { ok: false };
}
const rawShow = p => (p.kind === 'str' ? `"${p.raw}"` : p.kind === 'bool' ? 'true' : `{${p.raw}}`);

function elementInspector(pane, n) {
  const scr = screenOf(n);
  const hit = findEl(scr?.tree, S.sel.el);
  if (!hit) { screenInspector(pane, n); return; }
  const el = hit.node;
  const sp = spec(el.name);
  pane.append(h('div', { class: 'ihead' }, h('h2', {}, el.name), h('code', {}, el.id), sp ? (sp.status && sp.status !== 'stable' ? h('span', { class: 'tag warn' }, sp.status) : h('span', { class: 'tag ok' }, S.data.ds.name || 'DS')) : h('span', { class: 'tag warn' }, 'DS-Lücke')));
  if (sp?.description) pane.append(h('p', { class: 'hint' }, sp.description));
  if (!sp) pane.append(h('p', { class: 'hint' }, `Keine Komponente aus ${S.data.ds.name || 'dem Design System'}. Ersetzen oder als Lücke dokumentieren.`));
  pane.append(h('div', { class: 'grp' }, 'Eigenschaften'));
  for (const [name, ps] of Object.entries(sp?.props || {})) if (name !== 'children') pane.append(propRow(n, el, name, ps));
  for (const p of el.props.filter(p => !sp?.props?.[p.name])) pane.append(h('div', { class: 'row' }, h('span', { title: 'Nicht im Manifest' }, p.name), h('span', { class: 'code' }, rawShow(p))));
  const textual = sp ? sp.props?.children && sp.props.children.type !== 'node' : !!el.text;
  if (textual) {
    if (el.code || el.children.length) pane.append(h('div', { class: 'row' }, h('span', {}, 'Inhalt'), h('span', { class: 'code' }, 'Code-Block – im Code bearbeiten')));
    else pane.append(inputRow('Text', `${el.id}:#text`, el.text, v => screenOp(n.ref, { op: 'setText', id: el.id, text: v })));
  }
  interactionBlock(pane, n, el, sp);
  const isRoot = !hit.parent;
  pane.append(h('div', { class: 'grp' }, 'Anordnen'), h('div', { class: 'btns' },
    btn('↑ Hoch', () => moveSelected(-1), isRoot), btn('↓ Runter', () => moveSelected(1), isRoot),
    btn('Duplizieren', duplicateSelected, isRoot), btn('Löschen', removeSelected, isRoot, 'danger')));
  if (sp?.guidelines?.length || sp?.a11y?.length) {
    pane.append(h('div', { class: 'grp' }, 'Richtlinien'), h('ul', { class: 'guides' }, ...(sp.guidelines || []).map(g => h('li', {}, g)), ...(sp.a11y || []).map(g => h('li', {}, `A11y: ${g}`))));
  }
  const msgs = [...scr.lint.errors.filter(m => m.el === el.id).map(m => ({ msg: m.msg, level: 'error' })), ...scr.lint.warnings.filter(m => m.el === el.id).map(m => ({ msg: m.msg, level: 'warning' }))];
  if (msgs.length) pane.append(h('div', { class: 'grp' }, 'Prüfung'), msgList(msgs));
}
function propRow(n, el, name, ps) {
  const cur = el.props.find(p => p.name === name);
  const key = `${el.id}:${name}`;
  const set = value => screenOp(n.ref, { op: 'setProp', id: el.id, name, value });
  const lit = literal(cur);
  const label = h('label', { for: key, title: ps.type || '' }, name, ps.required ? h('span', { class: 'req' }, ' *') : null);
  let ctl;
  if (cur && !lit.ok) ctl = h('span', { class: 'code', title: 'Datenbindung oder Ausdruck – im Code ändern' }, `{${cur.raw}}`);
  else if (ps.type === 'handler') ctl = h('span', { class: 'code' }, cur ? rawShow(cur) : '—');
  else if (ps.enum) {
    ctl = h('select', { id: key, 'data-key': key, onchange: ev => { const v = ev.target.value; set(v === '' ? null : typeof ps.enum[0] === 'number' ? Number(v) : v); } },
      h('option', { value: '' }, '— Standard'), ...ps.enum.map(o => h('option', { value: String(o), selected: lit.value !== undefined && String(lit.value) === String(o) }, String(o))));
  } else if (ps.type === 'token') {
    const toks = S.data.ds.tokens.filter(t => !ps.group || t.path.startsWith(`${ps.group}.`));
    ctl = h('select', { id: key, 'data-key': key, onchange: ev => set(ev.target.value || null) },
      h('option', { value: '' }, '— Standard'), ...toks.map(t => h('option', { value: t.path, selected: lit.value === t.path }, `${t.path} · ${t.css}`)));
  } else if (ps.type === 'boolean') {
    ctl = h('input', { type: 'checkbox', id: key, 'data-key': key, checked: lit.value === true, onchange: ev => set(ev.target.checked ? true : null) });
  } else if (ps.type === 'string' || ps.type === 'number') {
    ctl = h('input', { type: ps.type === 'number' ? 'number' : 'text', id: key, 'data-key': key });
    ctl.value = lit.value === undefined ? '' : String(lit.value);
    ctl.addEventListener('change', () => { const v = ctl.value; set(v === '' ? null : ps.type === 'number' ? Number(v) : v); });
    ctl.addEventListener('keydown', e => { if (e.key === 'Enter') ctl.blur(); });
  } else if (/\[\]$/.test(ps.type || '')) {
    const strList = ps.type === 'string[]';
    ctl = h('textarea', { id: key, 'data-key': key, rows: '3', title: strList ? 'Ein Eintrag pro Zeile' : 'JSON' });
    ctl.value = lit.value === undefined ? '' : strList && Array.isArray(lit.value) ? lit.value.join('\n') : JSON.stringify(lit.value);
    ctl.addEventListener('change', () => {
      const t = ctl.value.trim();
      if (!t) return set(null);
      if (strList) return set(t.split('\n').map(s => s.trim()).filter(Boolean));
      try { set(JSON.parse(t)); } catch { toast('Kein gültiges JSON', 'bad'); }
    });
  } else ctl = h('span', { class: 'code' }, cur ? rawShow(cur) : '—');
  return h('div', { class: 'row' }, label, ctl);
}
function interactionBlock(pane, n, el, sp) {
  const f = flow();
  const idx = f.edges.findIndex(e => e.from === n.id && e.el === el.id);
  const handler = sp?.handler;
  if (!handler && idx < 0) return;
  const cur = handler ? el.props.find(p => p.name === handler) : null;
  pane.append(h('div', { class: 'grp' }, 'Interaktion'));
  const sel = h('select', {
    'data-key': `${el.id}:link`,
    'aria-label': 'Ziel der Interaktion',
    onchange: async ev => {
      const to = ev.target.value;
      if (!to) { if (idx >= 0) await flowOp({ op: 'disconnect', index: idx }); return; }
      await flowOp({ op: 'connect', from: n.id, el: el.id, to, label: idx >= 0 ? f.edges[idx].label : el.text || 'Tippen' });
    },
  }, h('option', { value: '' }, '— keine Verbindung'), ...f.nodes.filter(x => x.id !== n.id).map(x => h('option', { value: x.id, selected: idx >= 0 && f.edges[idx].to === x.id }, `${x.type === 'decision' ? '◆ ' : ''}${x.title || x.label || x.id}`)));
  pane.append(h('div', { class: 'row' }, h('span', {}, `${handler || 'Tippen'} →`), sel));
  if (cur && !/flow\.trigger\(/.test(cur.raw || '')) pane.append(h('p', { class: 'hint' }, `Im Code: {${cur.raw}}`));
  if (idx >= 0) pane.append(h('div', { class: 'btns' }, btn('Verbindung bearbeiten', () => select({ edge: idx }))));
}
function knowledgeBlock(pane, g) {
  pane.append(h('div', { class: 'grp' }, 'Wissen', g ? kchip(g.level) : null));
  if (!g || !g.refs.length) {
    pane.append(h('p', { class: 'hint' }, 'Keine Grundlage verknüpft – offen. Frag Claude: „Worauf stützt sich dieser Schritt?“'));
    return;
  }
  pane.append(h('ul', { class: 'refs' }, ...g.refs.map(r => h('li', {},
    h('div', {}, r.kind === 'insight' ? kchip(r.level) : kchip(r.status === 'bestätigt' ? 'belegt' : r.status === 'widerlegt' ? 'widerspruch' : 'annahme'), ' ', h('code', {}, r.id)),
    h('div', {}, r.text)))));
}
function screenInspector(pane, n) {
  const scr = screenOf(n);
  const f = flow();
  pane.append(h('div', { class: 'ihead' }, h('h2', {}, n.title || n.id), f.entry === n.id ? h('span', { class: 'tag ai' }, 'Einstieg') : null, n.exit ? h('span', { class: 'tag' }, 'Ausstieg') : null));
  pane.append(h('p', { class: 'hint' }, h('code', {}, `.wireflow/${n.ref}`), scr?.component ? ` · ${scr.component}` : ''));
  pane.append(inputRow('Titel', `${n.id}:title`, n.title || '', v => v && flowOp({ op: 'setNode', id: n.id, props: { title: v } })));
  if (scr?.stories?.length) {
    pane.append(h('div', { class: 'row' }, h('label', { for: `${n.id}:story` }, 'Zustand'), h('select', {
      id: `${n.id}:story`,
      'data-key': `${n.id}:story`,
      onchange: ev => flowOp({ op: 'setNode', id: n.id, props: { story: ev.target.value === scr.stories[0] ? null : ev.target.value } }),
    }, ...scr.stories.map(s => h('option', { value: s, selected: (n.story || scr.stories[0]) === s }, s)))));
  }
  if (scr?.error) pane.append(msgList([{ msg: scr.error, level: 'error' }]));
  if (scr?.lint) {
    const l = scr.lint;
    pane.append(h('div', { class: 'grp' }, 'Design System', h('em', {}, `${l.score.pct} % aus ${S.data.ds.name || 'DS'}`)));
    pane.append(msgList([...l.errors.map(m => ({ msg: m.msg, level: 'error' })), ...l.warnings.map(m => ({ msg: m.msg, level: 'warning' }))], 'Keine Befunde – nur Komponenten, Props und Tokens aus dem Design System.'));
  }
  knowledgeBlock(pane, f.knowledge?.nodes?.[n.id]);
  const outs = f.edges.map((e, i) => ({ e, i })).filter(x => x.e.from === n.id);
  pane.append(h('div', { class: 'grp' }, 'Interaktionen', h('em', {}, String(outs.length))));
  pane.append(outs.length
    ? h('ul', { class: 'msgs' }, ...outs.map(({ e, i }) => h('li', { 'data-go': '1', onclick: () => select({ edge: i }) }, `${e.el || 'Screen'} → ${nodeName(e.to)}${e.label ? ` („${e.label}“)` : ''}`)))
    : h('p', { class: 'hint' }, 'Noch keine. Element wählen und unter „Interaktion“ ein Ziel setzen.'));
  pane.append(h('div', { class: 'grp' }, 'Im Flow'), h('div', { class: 'btns' },
    btn('Als Einstieg', () => flowOp({ op: 'setEntry', id: n.id }), f.entry === n.id),
    btn(n.exit ? 'Kein Ausstieg' : 'Als Ausstieg', () => flowOp({ op: 'setNode', id: n.id, props: { exit: !n.exit } })),
    btn('Prototyp ab hier', () => { setMode('prototype'); protoStart(n.id); }),
    btn('Entfernen', () => { if (confirm(`„${n.title || n.id}“ aus dem Flow entfernen? Das Screen-Modul bleibt erhalten.`)) { flowOp({ op: 'removeNode', id: n.id }); select({}); } }, false, 'danger')));
}
function decisionInspector(pane, n) {
  const f = flow();
  pane.append(h('div', { class: 'ihead' }, h('h2', {}, n.label || n.id), h('span', { class: 'tag' }, 'Entscheidung')));
  pane.append(inputRow('Frage', `${n.id}:label`, n.label || '', v => v && flowOp({ op: 'setNode', id: n.id, props: { label: v } })));
  pane.append(inputRow('Variable', `${n.id}:var`, n.var || '', v => v && flowOp({ op: 'setNode', id: n.id, props: { var: v } })));
  const outs = f.edges.map((e, i) => ({ e, i })).filter(x => x.e.from === n.id);
  const yes = outs.find(x => x.e.when && x.e.when !== 'else');
  const no = outs.find(x => x.e.when === 'else');
  pane.append(h('div', { class: 'grp' }, 'Pfade'), pathRow('Ja', yes, n, n.var || 'true'), pathRow('Nein', no, n, 'else'));
  const iss = (f.issues || []).filter(i => i.ref === n.id);
  if (iss.length) pane.append(msgList(iss.map(i => ({ msg: i.message, level: i.level }))));
  knowledgeBlock(pane, f.knowledge?.nodes?.[n.id]);
  pane.append(h('div', { class: 'btns' }, btn('Entscheidung entfernen', () => { flowOp({ op: 'removeNode', id: n.id }); select({}); }, false, 'danger')));
}
function pathRow(label, x, n, when) {
  const f = flow();
  const sel = h('select', {
    'data-key': `${n.id}:${label}`,
    'aria-label': `${label}-Pfad`,
    onchange: ev => {
      const to = ev.target.value;
      if (to === '__new') return newScreenFor(n, label, when);
      if (!to) { if (x) flowOp({ op: 'disconnect', index: x.i }); return; }
      flowOp({ op: 'connect', from: n.id, to, label, when });
    },
  }, h('option', { value: '' }, x ? '— entfernen' : '— fehlt'), ...f.nodes.filter(m => m.id !== n.id).map(m => h('option', { value: m.id, selected: x?.e.to === m.id }, m.title || m.label || m.id)), h('option', { value: '__new' }, '+ Neuer Screen …'));
  return h('div', { class: 'row' }, h('span', { class: x ? '' : 'req' }, label), sel);
}
async function newScreenFor(n, label, when) {
  const title = prompt('Titel des neuen Screens', label === 'Nein' ? 'Fehlerfall' : 'Neuer Screen');
  if (!title) { renderRight(); return; }
  const r = await flowOp({ op: 'addScreen', title, x: n.x + 220, y: n.y + 560 });
  if (r?.node) await flowOp({ op: 'connect', from: n.id, to: r.node, label, when });
  if (r?.node) select({ node: r.node });
}
function edgeInspector(pane, i) {
  const f = flow();
  const e = f.edges[i];
  pane.append(h('div', { class: 'ihead' }, h('h2', {}, 'Verbindung'), e.when ? h('span', { class: `tag ${e.when === 'else' ? 'warn' : 'ok'}` }, e.when === 'else' ? 'sonst (Nein)' : `wenn ${e.when}`) : null));
  pane.append(h('p', { class: 'hint' }, `${nodeName(e.from)}${e.el ? ` · ${e.el}` : ''} → ${nodeName(e.to)}`));
  pane.append(inputRow('Beschriftung', `edge${i}:label`, e.label || '', v => flowOp({ op: 'updateEdge', index: i, props: { label: v } })));
  pane.append(h('div', { class: 'row' }, h('label', { for: `edge${i}:to` }, 'Ziel'), h('select', { id: `edge${i}:to`, 'data-key': `edge${i}:to`, onchange: ev => flowOp({ op: 'updateEdge', index: i, props: { to: ev.target.value } }) }, ...f.nodes.filter(m => m.id !== e.from).map(m => h('option', { value: m.id, selected: m.id === e.to }, m.title || m.label || m.id)))));
  if (e.set) pane.append(h('div', { class: 'row' }, h('span', {}, 'Setzt'), h('span', { class: 'code' }, Object.entries(e.set).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(', '))));
  knowledgeBlock(pane, f.knowledge?.edges?.[i]);
  pane.append(h('div', { class: 'btns' }, btn('Verbindung löschen', () => { flowOp({ op: 'disconnect', index: i }); select({}); }, false, 'danger')));
}
function kbar(counts) {
  const total = Object.values(counts || {}).reduce((a, b) => a + b, 0) || 1;
  return h('div', { class: 'kbar', role: 'img', 'aria-label': KORDER.filter(l => counts?.[l]).map(l => `${counts[l]}× ${KLABEL[l]}`).join(', ') }, ...KORDER.filter(l => counts?.[l]).map(l => h('i', { style: `width:${(counts[l] / total) * 100}%;background:var(--k-${l})`, title: `${counts[l]}× ${KLABEL[l]}` })));
}
function flowInspector(pane) {
  const f = flow();
  if (!f) { pane.append(h('p', { class: 'hint' }, 'Noch kein Flow. In Claude Code: /wireflow:flow')); return; }
  pane.append(h('div', { class: 'ihead' }, h('h2', {}, f.title || f.id)), h('p', { class: 'hint' }, h('code', {}, `.wireflow/${f.file}`)));
  const c = f.knowledge?.counts || {};
  pane.append(h('div', { class: 'grp' }, 'Wissensstand der Schritte'), kbar(c), h('div', { class: 'btns' }, ...KORDER.filter(l => c[l]).map(l => kchip(l, `${c[l]}× ${KLABEL[l]}`))));
  pane.append(h('div', { class: 'grp' }, 'Befunde', h('em', {}, String((f.issues || []).length))));
  pane.append(msgList((f.issues || []).map(i => ({ msg: i.message, level: i.level, go: i.ref })), 'Keine Befunde – alle Pfade vollständig.'));
  pane.append(h('div', { class: 'grp' }, 'Variablen'));
  const vars = Object.entries(f.variables || {});
  pane.append(vars.length ? h('div', { class: 'vars' }, ...vars.map(([k, v]) => h('label', {}, typeof v === 'boolean' ? h('input', { type: 'checkbox', checked: v, onchange: ev => flowOp({ op: 'setVariable', name: k, value: ev.target.checked }) }) : null, h('code', {}, k), typeof v === 'boolean' ? h('span', { class: 'hint' }, 'Startwert') : h('span', { class: 'code' }, JSON.stringify(v))))) : h('p', { class: 'hint' }, 'Keine. Entscheidungen legen Variablen an.'));
  pane.append(h('div', { class: 'grp' }, 'Hinzufügen'), h('div', { class: 'btns' }, btn('+ Screen', addScreenNode), btn('+ Entscheidung', addDecisionNode)));
  pane.append(h('p', { class: 'hint' }, 'Neue Screens entstehen als Code aus Komponenten des Design Systems. Claude kann sie ausarbeiten: „Gestalte den Screen … nach dem Pattern …“.'));
}
function freeSpot() {
  const f = flow();
  const maxX = Math.max(0, ...f.nodes.map(n => nodeRect(n).x + nodeRect(n).w));
  return { x: Math.round((maxX + 140) / 10) * 10, y: 0 };
}
async function addScreenNode() {
  const title = prompt('Titel des neuen Screens', 'Neuer Screen');
  if (!title) return;
  const p = freeSpot();
  const r = await flowOp({ op: 'addScreen', title, ...p });
  if (r?.node) { select({ node: r.node }); setTimeout(() => centerOn(r.node), 120); }
}
async function addDecisionNode() {
  const label = prompt('Frage der Entscheidung', 'Bedingung erfüllt?');
  if (!label) return;
  const p = freeSpot();
  const r = await flowOp({ op: 'addDecision', label, x: p.x, y: 300 });
  if (r?.node) { select({ node: r.node }); setTimeout(() => centerOn(r.node), 120); }
}

// ---------- Prototyp ----------
function protoStart(nodeId) {
  const f = flow();
  if (!f) return;
  const start = nodeById(nodeId) ? nodeId : f.entry || f.nodes.find(n => n.type === 'screen')?.id;
  S.proto = { flowId: f.id, node: start, history: [], vars: { ...(f.variables || {}) } };
  if (S.mode === 'prototype') { renderProto(); renderLeft(); renderRight(); }
}
function protoFrame() {
  let fr = S.frames.get(PROTO);
  if (!fr) {
    const box = h('div', { class: 'frame' });
    fr = { id: PROTO, proto: true, ref: '', story: '', v: S.dataV, url: '', iframe: null, next: null, boxes: {}, h: VH(), box, ov: null };
    S.frames.set(PROTO, fr);
  }
  return fr;
}
function renderProto() {
  const box = $('#proto');
  const f = flow();
  if (!S.protoDom) {
    const fr = protoFrame();
    const device = h('div', { class: 'device' }, fr.box);
    const wrap = h('div', { class: 'dwrap' }, device);
    S.protoDom = { bar: h('div', { class: 'pbar' }), wrap, device, foot: h('div', { class: 'hint' }), empty: h('div', { class: 'empty' }) };
    box.append(S.protoDom.bar, wrap, S.protoDom.foot, S.protoDom.empty);
  }
  const P = S.protoDom;
  if (!f || S.proto.flowId !== f.id || !nodeById(S.proto.node)) {
    if (f && S.proto.flowId !== f.id) { protoStart(); return; }
    if (f && !nodeById(S.proto.node) && f.nodes.length) { protoStart(); return; }
    P.empty.hidden = false;
    fill(P.empty, h('div', {}, h('b', {}, 'Nichts zu prototypen'), 'Der Flow braucht mindestens einen Screen.'));
    P.bar.hidden = P.wrap.hidden = P.foot.hidden = true;
    return;
  }
  P.empty.hidden = true;
  P.bar.hidden = P.wrap.hidden = P.foot.hidden = false;
  const n = nodeById(S.proto.node);
  const fr = protoFrame();
  fr.ref = n.ref;
  fr.story = n.story || '';
  fr.v = Math.max(fr.v, S.frames.get(n.id)?.v || 0);
  fr.box.style.width = `${VW()}px`;
  fr.box.style.height = `${VH()}px`;
  ensureIframe(fr);
  const sr = stage.getBoundingClientRect();
  const s = Math.max(0.3, Math.min(1, (sr.height - 120) / (VH() + 20), (sr.width - 40) / (VW() + 20)));
  P.device.style.width = `${VW() + 20}px`;
  P.device.style.height = `${VH() + 20}px`;
  P.device.style.transform = `scale(${s})`;
  P.device.style.transformOrigin = 'top left';
  P.wrap.style.width = `${(VW() + 20) * s}px`;
  P.wrap.style.height = `${(VH() + 20) * s}px`;
  fill(P.bar, h('b', {}, n.title || n.id), n.story ? h('span', { class: 'tag' }, n.story) : null, h('span', {}, `Schritt ${S.proto.history.length + 1}`));
  fill(P.foot, n.exit ? h('div', { class: 'endbanner' }, 'Ende des Flows erreicht.', btn('Neu starten', () => protoStart())) : 'Bedienen wie in der App. Klick ins Leere zeigt, wo es weitergeht.');
}
const truthy = v => !!v && v !== 'false' && v !== '0';
function cond(when) {
  if (!when || when === 'else') return false;
  const neg = when.startsWith('!');
  const v = truthy(S.proto.vars[neg ? when.slice(1) : when]);
  return neg ? !v : v;
}
function protoTrigger(el) {
  const f = flow();
  const e = f?.edges.find(x => x.from === S.proto.node && x.el === el);
  if (!e) { toast(`„${el}“ ist im Flow noch nicht verbunden – im Design-Modus unter „Interaktion“ ein Ziel setzen.`, 'warn'); return; }
  protoFollow(e);
}
function protoFollow(e) {
  const f = flow();
  Object.assign(S.proto.vars, e.set || {});
  let target = nodeById(e.to);
  let guard = 0;
  while (target && target.type === 'decision' && guard++ < 20) {
    const outs = f.edges.filter(x => x.from === target.id);
    const next = outs.find(x => cond(x.when)) || outs.find(x => x.when === 'else');
    if (!next) {
      toast(`„${target.label}“ → ${truthy(S.proto.vars[target.var]) ? 'Ja' : 'Nein'}: Für diesen Fall fehlt im Flow ein Pfad.`, 'bad');
      renderRight();
      return;
    }
    Object.assign(S.proto.vars, next.set || {});
    target = nodeById(next.to);
  }
  if (!target) return;
  S.proto.history.push(S.proto.node);
  S.proto.node = target.id;
  renderProto();
  renderLeft();
  renderRight();
}
function protoBack() {
  const prev = S.proto.history.pop();
  if (!prev) return;
  S.proto.node = prev;
  renderProto();
  renderLeft();
  renderRight();
}
function protoLeft() {
  const f = flow();
  const pane = h('div', { class: 'pane' });
  if (!f) return pane;
  pane.append(h('div', { class: 'grp' }, 'Springen zu'));
  pane.append(h('ul', { class: 'tree' }, ...f.nodes.filter(n => n.type === 'screen').map(n => h('li', {}, h('button', {
    type: 'button',
    'aria-current': String(S.proto.node === n.id),
    onclick: () => { S.proto.history.push(S.proto.node); S.proto.node = n.id; renderProto(); renderLeft(); renderRight(); },
  }, h('span', { class: 'ico' }, f.entry === n.id ? '▶' : '▢'), h('span', { class: 'nm' }, n.title || n.id))))));
  return pane;
}
function protoPanel(pane) {
  const f = flow();
  if (!f) return;
  pane.append(h('div', { class: 'ihead' }, h('h2', {}, 'Prototyp'), h('span', { class: 'tag' }, f.title || f.id)));
  pane.append(h('div', { class: 'btns' }, btn('← Zurück', protoBack, !S.proto.history.length), btn('Neu starten', () => protoStart())));
  pane.append(h('div', { class: 'grp' }, 'Variablen'), h('p', { class: 'hint' }, 'Bestimmen, welchen Weg Entscheidungen nehmen.'));
  const vars = Object.entries(S.proto.vars);
  pane.append(vars.length ? h('div', { class: 'vars' }, ...vars.map(([k, v]) => h('label', {}, h('input', { type: 'checkbox', checked: truthy(v), onchange: ev => { S.proto.vars[k] = ev.target.checked; renderProto(); } }), h('code', {}, k)))) : h('p', { class: 'hint' }, 'Keine.'));
  const outs = f.edges.filter(e => e.from === S.proto.node);
  pane.append(h('div', { class: 'grp' }, 'Auf diesem Screen'));
  pane.append(outs.length ? h('ul', { class: 'msgs' }, ...outs.map(e => h('li', { 'data-go': '1', onclick: () => protoFollow(e) }, `${e.label || e.el || 'Weiter'} → ${nodeName(e.to)}`))) : h('p', { class: 'hint' }, 'Keine Verbindungen.'));
  pane.append(h('div', { class: 'grp' }, 'Pfad'), h('ol', { class: 'path' }, ...[...S.proto.history, S.proto.node].map((id, i, a) => h('li', { class: i === a.length - 1 ? 'cur' : '' }, nodeName(id)))));
}

// ---------- Journey ----------
function renderJourney() {
  const doc = $('#doc');
  const f = flow();
  const j = S.data.journeys.find(x => x.id === f?.journey) || S.data.journeys[0];
  if (!j) { fill(doc, h('div', { class: 'empty' }, h('div', {}, h('b', {}, 'Noch keine Journey'), 'In Claude Code: /wireflow:journey – aus Research, Interviews oder dem, was das Team weiß.'))); return; }
  const ins = id => S.data.knowledge.insights.find(i => i.id === id);
  const cols = j.phases.length;
  const grid = h('div', { class: 'jgrid', style: `grid-template-columns:repeat(${cols},minmax(190px,1fr))` }, ...j.phases.map(p => h('section', { class: 'jcol' },
    h('h3', {}, p.title),
    h('h4', {}, 'Handlungen'), h('ul', {}, ...(p.actions || []).map(a => h('li', {}, a))),
    h('h4', {}, 'Pain Points'), h('ul', { class: 'pp' }, ...(p.painPoints || []).map(pp => {
      const i = pp.insight ? ins(pp.insight) : null;
      return h('li', {}, pp.text, h('div', {}, i ? kchip(i.wissensstand, `${KLABEL[i.wissensstand] || i.wissensstand} · ${i.id}`) : kchip('offen', 'ohne Beleg')));
    })),
    h('h4', {}, 'Chancen'), h('ul', {}, ...(p.opportunities || []).map(o => h('li', {}, o))),
    p.flow ? h('div', { class: 'btns' }, btn(`Flow öffnen: ${S.data.flows.find(x => x.id === p.flow)?.title || p.flow}`, () => { S.flowId = p.flow; setMode('design'); })) : null,
  )));
  const emo = h('div', { class: 'emo', 'aria-label': 'Emotionskurve' });
  fill(doc, 
    h('h1', {}, j.title),
    h('p', { class: 'sub' }, [j.variant ? `${j.variant === 'ist' ? 'Ist-Journey' : j.variant === 'soll' ? 'Soll-Journey' : j.variant}` : '', j.persona, j.scenario].filter(Boolean).join(' · ')),
    emo,
    grid,
  );
  requestAnimationFrame(() => {
    const W = emo.clientWidth;
    const H = 86;
    const colsEl = [...grid.children];
    const base = grid.getBoundingClientRect().left;
    const pts = j.phases.map((p, i) => { const r = colsEl[i].getBoundingClientRect(); return [r.left - base + r.width / 2, H / 2 - (p.emotion || 0) * 16]; });
    emo.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Emotion je Phase"><line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke-dasharray="4 4"/><polyline points="${pts.map(p => p.join(',')).join(' ')}"/>${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="5"><title>${esc(j.phases[i].title)}: ${j.phases[i].emotion ?? 0}</title></circle>`).join('')}</svg>`;
  });
}

// ---------- Wissen ----------
function usages(kind, id) {
  const out = [];
  for (const f of S.data.flows) for (const n of f.nodes) if ((n.basis?.[kind] || []).includes(id)) out.push({ f, n });
  return out;
}
function usageBtns(kind, id) {
  const u = usages(kind, id);
  if (!u.length) return null;
  return h('div', { class: 'meta' }, 'Genutzt in:', ...u.map(({ f, n }) => h('button', { type: 'button', class: 'btn', onclick: () => { S.flowId = f.id; setMode('design'); select({ node: n.id }); centerOn(n.id); } }, n.title || n.label || n.id)));
}
function renderKnowledge() {
  const doc = $('#doc');
  const k = S.data.knowledge;
  const f = flow();
  const risk = new Map(k.risk.map((id, i) => [id, i]));
  const ass = [...k.assumptions].sort((a, b) => (risk.get(a.id) ?? 99) - (risk.get(b.id) ?? 99));
  const kn = f?.knowledge;
  fill(doc, 
    h('h1', {}, 'Wissen'),
    h('p', { class: 'sub' }, 'Was wir über Nutzer:innen wissen – und was noch nicht. Belegtes, Hinweise, Annahmen und offene Fragen tragen die Flows.'),
    f ? h('section', { class: 'kflow' }, h('b', {}, `Flow „${f.title}“`), kbar(kn?.counts), h('div', { class: 'nodes' }, ...f.nodes.map(n => h('button', { type: 'button', onclick: () => { setMode('design'); select({ node: n.id }); centerOn(n.id); } }, kchip(kn?.nodes?.[n.id]?.level || 'offen'), n.title || n.label || n.id)))) : null,
    h('div', { class: 'kgrid' },
      h('section', { class: 'kcol' }, h('h2', {}, 'Insights', h('span', { class: 'tag' }, String(k.insights.length))), ...k.insights.map(i => h('div', { class: 'kitem' },
        h('div', { class: 'meta' }, kchip(i.wissensstand), h('code', {}, i.id)), h('p', {}, i.aussage),
        (i.fakten || []).length ? h('div', { class: 'meta' }, `Belege: ${(i.fakten || []).join(', ')}`) : h('div', { class: 'meta' }, 'Ohne Beleg'), usageBtns('insights', i.id)))),
      h('section', { class: 'kcol' }, h('h2', {}, 'Annahmen', h('span', { class: 'tag' }, String(k.assumptions.length))), h('p', { class: 'hint' }, 'Nach Risiko: wichtig und ohne Evidenz zuerst.'), ...ass.map(a => h('div', { class: `kitem${a.wichtigkeit === 'hoch' && a.evidenz === 'keine' ? ' risk' : ''}` },
        h('div', { class: 'meta' }, kchip(a.status === 'bestätigt' ? 'belegt' : a.status === 'widerlegt' ? 'widerspruch' : 'annahme', a.status || 'offen'), h('code', {}, a.id), a.kategorie ? h('span', { class: 'tag' }, a.kategorie) : null, a.wichtigkeit ? h('span', { class: `tag ${a.wichtigkeit === 'hoch' ? 'warn' : ''}` }, `Wichtigkeit ${a.wichtigkeit}`) : null, a.evidenz ? h('span', { class: 'tag' }, `Evidenz ${a.evidenz}`) : null),
        h('p', {}, a.aussage),
        a.test ? h('div', { class: 'meta' }, `Test: ${a.test.methode || ''}${a.test.frage ? ` – ${a.test.frage}` : ''}`) : null,
        a.herkunft ? h('div', { class: 'meta' }, `Herkunft: ${a.herkunft}`) : null, usageBtns('assumptions', a.id)))),
      h('section', { class: 'kcol' }, h('h2', {}, 'Offene Fragen', h('span', { class: 'tag' }, String(k.questions.length))), ...k.questions.map(q => h('div', { class: 'kitem' },
        h('div', { class: 'meta' }, kchip(q.status === 'beantwortet' ? 'belegt' : 'offen', q.status || 'offen'), h('code', {}, q.id)), h('p', {}, q.frage), q.methode ? h('div', { class: 'meta' }, `Methode: ${q.methode}`) : null))),
    ),
  );
}

// ---------- Kopf, Status, Modus ----------
function renderTop() {
  $('#crumb').textContent = S.data.project.name || '';
  const sel = $('#flowSel');
  const opts = S.data.flows.map(f => `<option value="${esc(f.id)}"${f.id === S.flowId ? ' selected' : ''}>${esc(f.title || f.id)}</option>`).join('');
  if (sel.innerHTML !== opts) sel.innerHTML = opts || '<option>Kein Flow</option>';
  sel.disabled = !S.data.flows.length;
  document.querySelectorAll('[data-fid]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.fid === S.fid)));
}
function renderStatus() {
  const d = S.data;
  const f = flow();
  const hints = { design: 'Titel ziehen: Screen verschieben · Leere Fläche ziehen: schwenken · ⌘/Strg+Scrollen: zoomen · 0: alles zeigen', prototype: 'Variablen rechts steuern die Entscheidungen', journey: 'Pain Points zeigen ihren Beleg', knowledge: 'Annahmen nach Risiko sortiert' };
  fill($('#status'), 
    h('span', {}, `${d.ds.name || 'Design System'} ${d.ds.version || ''} · ${d.ds.components.length} Komponenten · ${d.ds.patterns.length} Patterns`),
    h('span', {}, `${Object.keys(d.screens).length} Screens · ${d.flows.length} Flow(s)`),
    f ? h('span', {}, `${(f.issues || []).filter(i => i.level !== 'info').length} Befunde`) : null,
    h('span', { class: 'sp' }, hints[S.mode]),
  );
}
function renderAll() {
  if (!S.data) return;
  renderTop();
  if (S.mode === 'design') {
    renderCanvas();
    if (!S.fitted && flow()) { S.fitted = true; requestAnimationFrame(fit); }
  } else if (S.mode === 'prototype') renderProto();
  else if (S.mode === 'journey') renderJourney();
  else renderKnowledge();
  renderLeft();
  renderRight();
  renderStatus();
}
function setMode(m) {
  S.mode = m;
  $('#app').dataset.mode = m;
  document.querySelectorAll('.modes button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  world.hidden = m !== 'design';
  $('#proto').hidden = m !== 'prototype';
  $('#doc').hidden = !(m === 'journey' || m === 'knowledge');
  stage.querySelector(':scope > .empty')?.toggleAttribute('hidden', m !== 'design');
  if (m === 'prototype' && (S.proto.flowId !== S.flowId || !nodeById(S.proto.node))) protoStart();
  renderAll();
  syncSelection();
}

function toast(msg, kind = '') {
  const box = $('#toasts');
  const t = h('div', { class: `toast ${kind}`, role: 'status' }, msg);
  box.append(t);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => t.remove(), kind === 'bad' ? 7000 : 3800);
}

// ---------- Tastatur und Kopfzeile ----------
addEventListener('keydown', e => {
  const typing = e.target.closest?.('input,textarea,select,[contenteditable]');
  const mod = e.metaKey || e.ctrlKey;
  if (typing) { if (e.key === 'Escape') e.target.blur(); return; }
  if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
  if (S.mode === 'design') {
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel.el) { e.preventDefault(); removeSelected(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel.edge != null) { e.preventDefault(); flowOp({ op: 'disconnect', index: S.sel.edge }); select({}); return; }
    if (mod && e.key.toLowerCase() === 'd' && S.sel.el) { e.preventDefault(); duplicateSelected(); return; }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && S.sel.el) { e.preventDefault(); moveSelected(e.key === 'ArrowUp' ? -1 : 1); return; }
    if (e.key === 'Escape') { selectParent(); return; }
    if (!mod && (e.key === '0' || e.key === '!')) { fit(); return; }
    if (!mod && (e.key === '+' || e.key === '=')) { zoomCenter(1.25); return; }
    if (!mod && e.key === '-') { zoomCenter(0.8); return; }
  }
  if (S.mode === 'prototype' && e.key === 'Escape') { protoBack(); return; }
  if (mod || e.altKey) return;
  const m = { d: 'design', p: 'prototype', j: 'journey', w: 'knowledge' }[e.key.toLowerCase()];
  if (m) setMode(m);
});
document.querySelector('.modes').addEventListener('click', e => { const b = e.target.closest('button[data-mode]'); if (b) setMode(b.dataset.mode); });
document.querySelector('.seg').addEventListener('click', e => {
  const b = e.target.closest('button[data-fid]');
  if (!b || b.dataset.fid === S.fid) return;
  S.fid = b.dataset.fid;
  renderAll();
});
$('#flowSel').addEventListener('change', e => {
  S.flowId = e.target.value;
  S.sel = { node: null, el: null, edge: null };
  S.fitted = false;
  renderAll();
  syncSelection();
});
addEventListener('resize', () => { if (S.mode === 'prototype') renderProto(); });

async function init() {
  try {
    S.data = await api('/api/project');
    S.dataV = S.data.v;
  } catch (e) {
    stage.append(h('div', { class: 'empty' }, h('div', {}, h('b', {}, 'Projekt nicht lesbar'), e.message)));
    return;
  }
  S.flowId = S.data.flows[0]?.id || null;
  applyView();
  connect();
  setMode('design');
}
init();
