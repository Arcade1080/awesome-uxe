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
  sel: { node: null, el: null, edge: null, variant: null },
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
  rightTab: 'design',
  codeSub: 'screen',
  codeCache: new Map(),
  chat: { messages: [], connected: false, channel: false, unread: 0, attach: true },
  menu: null,
  working: new Map(),
  elTab: 'props',
  scope: 'one',
  picker: null,
  sb: { status: 'sucht', url: null, base: '', hash: '', hint: '', dirs: [], groups: [], flow: null, pins: new Set(), pos: {}, file: null },
};

// ---------- Zugriff ----------
const SB = '__storybook';
const isSb = n => n?.type === 'story';
const flow = () => (S.flowId === SB ? S.sb.flow : S.data?.flows.find(f => f.id === S.flowId) || null);
const nodeById = id => flow()?.nodes.find(n => n.id === id) || null;
const nodeName = id => { const n = nodeById(id); return n ? n.title || n.label || n.id : id; };
const screenOf = n => (n && n.type === 'screen' ? S.data.screens[n.ref] || null : isSb(n) ? sbScreen(n) : null);
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
  es.addEventListener('chat', e => onChat(JSON.parse(e.data)));
  es.addEventListener('storybook', () => loadSb());
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
    const selection = flow()?.storybook ? sbSelection() : {
      flow: S.flowId,
      modus: S.mode,
      knoten: n?.id || null,
      titel: n ? n.title || n.label || null : null,
      screen: S.sel.variant || n?.ref || null,
      variante: S.sel.variant || null,
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
  S.sel = { node: sel.node ?? null, el: sel.el ?? null, edge: sel.edge ?? null, variant: sel.variant ?? null };
  closeMenu();
  if (S.mode === 'design') renderCanvas();
  renderLeft();
  renderRight();
  syncSelection();
}
function validateSelection() {
  const f = flow();
  if (!f) { S.sel = { node: null, el: null, edge: null, variant: null }; return; }
  if (S.sel.edge != null && !f.edges[S.sel.edge]) S.sel.edge = null;
  const n = nodeById(S.sel.node);
  if (!n) { S.sel.node = null; S.sel.el = null; S.sel.variant = null; return; }
  if (S.sel.variant && !(n.variants || []).some(v => v.ref === S.sel.variant)) S.sel.variant = null;
  const scr = screenOf(n);
  if (S.sel.el && !(isSb(n) && !scr?.tree) && !(scr?.tree && findEl(scr.tree, S.sel.el))) S.sel.el = null;
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
  if (!hit || isRoot || isSb(n)) return;
  const r = await screenOp(n.ref, { op: 'remove', id: hit.node.id });
  if (r) select({ node: n.id, el: hit.parent?.id || null });
}
async function duplicateSelected() {
  const { n, hit, isRoot } = selected();
  if (!hit || isRoot || isSb(n)) return;
  const r = await screenOp(n.ref, { op: 'duplicate', id: hit.node.id });
  if (r?.selected) select({ node: n.id, el: r.selected });
}
async function moveSelected(delta) {
  const { n, hit, isRoot } = selected();
  if (!hit || isRoot || isSb(n)) return;
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
  return { x: p.x, y: p.y, w: n.w || VW(), h: S.frames.get(n.id)?.h || VH() };
}
function fit() {
  const f = flow();
  if (!f || !f.nodes.length) return;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const r of [...f.nodes.map(nodeRect), ...variantRects(f).map(v => v.rect)]) {
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
  if (fr.sb) return `/iframe.html?${new URLSearchParams({ viewMode: 'story', id: fr.sb, wfv: String(fr.sbv || 1) })}`;
  const q = new URLSearchParams({ ref: fr.ref, story: fr.story || '', mode: S.fid, ui: fr.proto ? 'prototype' : 'design', v: String(fr.v) });
  if (fr.proto) q.set('vars', JSON.stringify(S.proto.vars));
  return `/render?${q}`;
}
function ensureIframe(fr) {
  const url = frameUrl(fr);
  if (fr.url === url) return;
  fr.url = url;
  const ifr = h('iframe', { src: url, title: fr.sb ? `Story ${fr.sb}` : `Screen ${fr.ref}`, tabindex: fr.proto ? '0' : '-1' });
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
    if (!id.startsWith('v:') && (!f || !f.nodes.some(n => n.id === id))) {
      el.remove();
      S.nodeEls.delete(id);
      S.frames.delete(id);
    }
  }
  let empty = stage.querySelector(':scope > .empty');
  if (f?.storybook && !f.nodes.length) {
    empty?.remove();
    stage.append(h('div', { class: 'empty' }, h('div', {}, h('b', {}, S.sb.status === 'verbunden' ? 'Keine Stories' : 'Storybook läuft nicht'), S.sb.status === 'verbunden' ? 'Storybook ist verbunden, hat aber keine Stories.' : S.sb.hint || 'Suche Storybook …')));
    edgesSvg.innerHTML = '';
    fill(labelsEl);
    renderVariants(null);
    return;
  }
  if (!f) {
    if (!empty) stage.append(h('div', { class: 'empty' }, h('div', {}, h('b', {}, 'Noch kein Flow'), 'In Claude Code: /wireflow:flow – oder eine Journey mit /wireflow:journey anlegen.')));
    edgesSvg.innerHTML = '';
    fill(labelsEl, );
    renderVariants(null);
    return;
  }
  empty?.remove();
  for (const n of f.nodes) renderNode(n);
  renderVariants(f);
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
  } else updateNode(n);
}

function createScreen(id) {
  const title = h('div', { class: 'ftitle' });
  const ov = h('div', { class: 'ov' });
  const box = h('div', { class: 'frame' }, ov);
  const el = h('div', { class: 'node scr' }, title, box);
  const fr = { id, ref: '', story: '', v: S.dataV, url: '', iframe: null, next: null, boxes: {}, h: VH(), box, ov, title, el, failed: false };
  S.frames.set(id, fr);
  title.addEventListener('pointerdown', e => startNodeDrag(e, id));
  title.addEventListener('contextmenu', e => { e.preventDefault(); select({ node: id }); openMenu(e.clientX, e.clientY); });
  ov.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    const p = localPos(e, fr);
    const hitId = hitTest(fr, p.x, p.y);
    select(hitId ? { node: id, el: hitId } : { node: id });
    openMenu(e.clientX, e.clientY);
  });
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
    h('button', {
      type: 'button',
      class: 'fmenu',
      title: 'Aktionen: Varianten, Review, Weiter, Zustände (Rechtsklick oder Taste .)',
      'aria-label': `Aktionen für ${n.title || n.id}`,
      onpointerdown: ev => ev.stopPropagation(),
      onclick: ev => {
        const r = ev.currentTarget.getBoundingClientRect();
        select({ node: n.id });
        openMenu(r.left + r.width / 2, r.bottom + 120);
      },
    }, '✦'),
  );
  fr.el.classList.toggle('working', S.working.has(n.ref));
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
  for (const g of gapsOf(f)) {
    if (g.stub) svg += `<path class="miss" d="M${g.stub[0].x},${g.stub[0].y} L${g.stub[1].x},${g.stub[1].y}"/>`;
    labels.push(gapCard(g));
  }
  edgesSvg.innerHTML = svg;
  fill(labelsEl, ...labels);
}

// ---------- Canvas: Auswahl, Hover, Einfügen ----------
function localPos(e, fr) {
  const r = fr.ov.getBoundingClientRect();
  const s = r.width / (fr.w || VW());
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
  if (fr.sb) return;
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
  if (fr.sb) return null;
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
    if (fr.kind !== 'component' && fr.h > VH() + 2) kids.push(h('div', { class: 'fold', style: `top:${VH()}px` }, h('span', {}, `Sichtbereich ${VH()} px`)));
    const box = (id, cls, label) => {
      const b = fr.boxes[id];
      if (!b) return null;
      return h('div', { class: cls, style: `left:${b[0]}px;top:${b[1]}px;width:${b[2]}px;height:${b[3]}px` }, label ? h('span', {}, label) : null);
    };
    if (S.hover?.node === fr.id && S.hover.el && S.hover.el !== S.sel.el && !S.drag) kids.push(box(S.hover.el, 'hb'));
    if (S.sel.node === fr.id && S.sel.el && S.drag?.kind !== 'move' && !S.sel.variant) {
      const scr = fr.sb ? sbScreen(nodeById(fr.id)) : S.data.screens[fr.ref];
      const hitSel = findEl(scr?.tree, S.sel.el);
      const b = fr.boxes[S.sel.el];
      if (b && hitSel) {
        kids.push(box(S.sel.el, 'sb', `${hitSel.node.name} · ${b[2]} × ${b[3]}`));
        if (hitSel.parent && !fr.sb) {
          kids.push(h('button', {
            type: 'button', class: 'hdl add', title: 'Komponente darunter einfügen', 'aria-label': 'Komponente darunter einfügen',
            style: `left:${b[0] + b[2] / 2}px;top:${b[1] + b[3]}px`,
            onpointerdown: ev => ev.stopPropagation(),
            onclick: ev => { ev.stopPropagation(); const r = ev.currentTarget.getBoundingClientRect(); openPicker(r.left - 10, r.bottom + 8); },
          }, '+'));
        }
        if (!fr.sb && spec(hitSel.node.name)?.handler) {
          kids.push(h('button', {
            type: 'button', class: 'hdl link', title: 'Ziehen: mit einem anderen Screen verbinden', 'aria-label': 'Verbindung ziehen',
            style: `left:${b[0] + b[2]}px;top:${b[1]}px`,
            onpointerdown: ev => startLinkDrag(ev, fr, S.sel.el),
          }, '↗'));
        }
      }
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
        if (flow()?.storybook) sbMoved(id, d.pos);
        else await flowOp({ op: 'moveNode', id, x: d.pos.x, y: d.pos.y });
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
  closeMenu();
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
    if (d.sb) sbTreeArrived(fr, d.tree || []);
    if (!fr.proto) {
      const nh = fr.kind === 'component' ? Math.max(80, Math.min(Math.round(d.content || 0), 1400)) : Math.max(VH(), Math.min(Math.round(d.height || 0), 6000));
      if (nh !== fr.h) { fr.h = nh; fr.box.style.height = `${nh}px`; if (fr.sb) sbRelayoutSoon(); }
      renderEdges();
      renderOverlays();
      const n = nodeById(fr.id);
      if (n && (d.failed || fr.sb)) updateNode(n);
      if (S.sel.node === fr.id && S.sel.el && S.rightTab === 'design' && S.elTab === 'style') {
        clearTimeout(S.styleTimer);
        S.styleTimer = setTimeout(renderRight, 60);
      }
    } else {
      fr.iframe.contentWindow.postMessage({ wf: 1, type: 'hotspots', ids: (flow()?.edges || []).filter(x => x.from === S.proto.node && x.el).map(x => x.el) }, location.origin);
    }
  }
  if (d.type === 'error' && hit.current && !fr.proto) {
    fr.failed = true;
    if (d.sb) fr.sbError = d.message;
    const n = nodeById(fr.id);
    if (n) updateNode(n);
  }
  if (d.sb && d.type === 'story') {
    fr.sbInfo = d.info;
    if (S.sel.node === fr.id && S.rightTab === 'design') renderRight();
  }
  if (d.sb && d.type === 'args') {
    if (fr.sbInfo) fr.sbInfo.args = d.args;
    if (S.sel.node === fr.id && !S.sel.el && S.rightTab === 'design') renderRight();
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
  if (f?.storybook) { sbLayers(pane); return; }
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
    if (S.mode === 'prototype') {
      const pane = h('div', { class: 'pane' });
      protoPanel(pane);
      fill(R, pane);
      return;
    }
    const tabsEl = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Rechte Spalte' }, ...[['design', 'Design'], ['code', 'Code'], ['chat', chatTabLabel()]].map(([id, label]) => h('button', {
      type: 'button',
      role: 'tab',
      'data-tab': id,
      'aria-selected': String(S.rightTab === id),
      onclick: () => { S.rightTab = id; if (id === 'chat') S.chat.unread = 0; renderRight(); },
    }, label)));
    const pane = h('div', { class: `pane${S.rightTab === 'chat' ? ' chatpane' : ''}` });
    if (S.rightTab === 'code') codePane(pane);
    else if (S.rightTab === 'chat') chatPane(pane);
    else designPane(pane);
    fill(R, tabsEl, pane);
  });
}
function designPane(pane) {
  const n = nodeById(S.sel.node);
  if (flow()?.storybook) {
    if (isSb(n) && S.sel.el) sbElementInspector(pane, n);
    else if (isSb(n)) sbStoryInspector(pane, n);
    else sbBoardInspector(pane);
    return;
  }
  if (S.sel.edge != null && flow()?.edges[S.sel.edge]) edgeInspector(pane, S.sel.edge);
  else if (n?.type === 'screen' && S.sel.variant) variantInspector(pane, n, S.sel.variant);
  else if (n?.type === 'screen' && S.sel.el) elementInspector(pane, n);
  else if (n?.type === 'screen') screenInspector(pane, n);
  else if (n?.type === 'decision') decisionInspector(pane, n);
  else flowInspector(pane);
  changesBlock(pane);
}
function literal(p) {
  if (!p) return { ok: true, value: undefined };
  if (p.kind === 'str') return { ok: true, value: p.raw };
  if (p.kind === 'bool') return { ok: true, value: true };
  if (p.kind === 'expr') { try { return { ok: true, value: JSON.parse(p.raw) }; } catch { return { ok: false }; } }
  return { ok: false };
}
const rawShow = p => (p.kind === 'str' ? `"${p.raw}"` : p.kind === 'bool' ? 'true' : `{${p.raw}}`);

// ---------- Design-Panel: Props (was es ist und tut) | Style (wie es aussieht) ----------
function contentLabel(el) {
  if (el.text) return el.text;
  for (const k of ['title', 'label', 'initials']) {
    const l = literal(el.props.find(p => p.name === k));
    if (l.ok && typeof l.value === 'string' && l.value) return l.value;
  }
  return '';
}
function elementInspector(pane, n) {
  const scr = screenOf(n);
  const hit = findEl(scr?.tree, S.sel.el);
  if (!hit) { screenInspector(pane, n); return; }
  const el = hit.node;
  const sp = spec(el.name);
  const content = contentLabel(el);
  pane.append(h('div', { class: 'ihead' },
    h('h2', {}, el.name, content ? h('span', { class: 'hsub' }, ` · ${content.length > 26 ? `${content.slice(0, 25)}…` : content}`) : null),
    h('code', {}, el.id),
    sp ? (sp.status && sp.status !== 'stable' ? h('span', { class: 'tag warn' }, sp.status) : h('span', { class: 'tag ok' }, S.data.ds.name || 'DS')) : h('span', { class: 'tag warn' }, 'DS-Lücke')));
  if (sp?.description) pane.append(h('p', { class: 'hint' }, sp.description));
  pane.append(h('div', { class: 'seg elseg', role: 'tablist', 'aria-label': 'Props oder Style' }, ...[['props', 'Props'], ['style', 'Style']].map(([id, label]) => h('button', {
    type: 'button', role: 'tab', 'aria-selected': String(S.elTab === id), 'aria-pressed': String(S.elTab === id),
    onclick: () => { S.elTab = id; renderRight(); },
  }, label))));
  if (S.elTab === 'style') stylePane(pane, n, el, sp);
  else propsPane(pane, n, el, sp, hit, scr);
}
function propsPane(pane, n, el, sp, hit, scr) {
  if (!sp) pane.append(h('p', { class: 'hint' }, `Keine Komponente aus ${S.data.ds.name || 'dem Design System'}. Tauschen oder als Lücke dokumentieren.`));
  if (hit.parent) pane.append(swapRow(n, el, sp));
  const entries = Object.entries(sp?.props || {}).filter(([name, ps]) => name !== 'children' && ps.type !== 'token' && ps.type !== 'node');
  pane.append(h('div', { class: 'grp' }, `${el.name}-Props`));
  if (!entries.length) pane.append(h('p', { class: 'hint' }, Object.values(sp?.props || {}).some(p => p.type === 'token') ? 'Keine weiteren Props – Abstände stehen unter Style.' : 'Keine Props.'));
  for (const [name, ps] of entries) pane.append(propRow(n, el, name, ps));
  for (const p of el.props.filter(p => !sp?.props?.[p.name])) pane.append(h('div', { class: 'row' }, h('span', { title: 'Nicht im Manifest' }, p.name), h('span', { class: 'code' }, rawShow(p))));
  slotsBlock(pane, n, el, sp);
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
// Komponente tauschen: zuerst Komponenten mit verwandtem Zweck (gleiche Intent-Familie)
function swapRow(n, el, sp) {
  const fam = new Set((sp?.intents || []).map(i => i.split('.')[0]));
  const all = S.data.ds.components.filter(c => c.name !== el.name);
  const near = all.filter(c => (c.intents || []).some(i => fam.has(i.split('.')[0])));
  const rest = all.filter(c => !near.includes(c));
  const sel = h('select', { 'data-key': `${el.id}:swap`, 'aria-label': 'Komponente tauschen gegen', onchange: async ev => {
    const to = ev.target.value;
    if (!to) return;
    const r = await screenOp(n.ref, { op: 'swap', id: el.id, component: to });
    if (r) toast(`${el.name} → ${to} getauscht – passende Props bleiben.`);
  } },
  h('option', { value: '' }, 'Tauschen gegen …'),
  near.length ? h('optgroup', { label: 'Ähnlicher Zweck' }, ...near.map(c => h('option', { value: c.name }, c.name))) : null,
  h('optgroup', { label: near.length ? 'Weitere' : 'Komponenten' }, ...rest.map(c => h('option', { value: c.name }, c.name))));
  return h('div', { class: 'row' }, h('span', {}, 'Komponente'), sel);
}
// Slots: Inhalte, die selbst Komponenten sind (Props vom Typ node und children)
function slotsBlock(pane, n, el, sp) {
  const slots = Object.entries(sp?.props || {}).filter(([k, ps]) => ps.type === 'node' && k !== 'children');
  const textual = sp ? sp.props?.children && sp.props.children.type !== 'node' : !!el.text;
  const container = sp?.props?.children?.type === 'node';
  if (!slots.length && !textual && !container) return;
  pane.append(h('div', { class: 'grp' }, 'Inhalt und Slots'));
  if (textual) {
    if (el.code || el.children.length && el.children.some(c => c.type === 'el')) pane.append(h('div', { class: 'row' }, h('span', {}, 'children'), h('span', { class: 'code' }, 'Code-Block – im Code bearbeiten')));
    else pane.append(inputRow('Text', `${el.id}:#text`, el.text, v => screenOp(n.ref, { op: 'setText', id: el.id, text: v }), 'Nicht gesetzt'));
  }
  if (container) {
    pane.append(h('div', { class: 'row' }, h('span', {}, 'children'), h('div', { class: 'ctl' },
      h('span', { class: 'slotv' }, `${el.children.length} Element${el.children.length === 1 ? '' : 'e'}`),
      h('button', { type: 'button', class: 'btn sm', onclick: () => { S.leftTab = 'layers'; renderLeft(); } }, 'Ebenen ›'),
      h('button', { type: 'button', class: 'btn sm', onclick: () => { S.leftTab = 'components'; renderLeft(); } }, '+ Einfügen'))));
  }
  for (const [name] of slots) {
    const cur = el.props.find(p => p.name === name);
    const inner = cur?.raw?.match(/^<([A-Z][\w.]*)/)?.[1];
    const pick = h('select', { 'data-key': `${el.id}:slot:${name}`, 'aria-label': `${name} tauschen gegen`, onchange: async ev => {
      const to = ev.target.value;
      if (!to) return;
      const c = spec(to);
      const props = Object.entries(c?.defaults?.props || {}).map(([k, v]) => (typeof v === 'string' ? `${k}="${v}"` : typeof v === 'object' && v && 'expr' in v ? `${k}={${v.expr}}` : `${k}={${JSON.stringify(v)}}`)).join(' ');
      await screenOp(n.ref, { op: 'setProp', id: el.id, name, value: { expr: `<${to}${props ? ` ${props}` : ''} />` } });
    } }, h('option', { value: '' }, 'Tauschen gegen …'), ...S.data.ds.components.filter(c => !c.props?.children || c.props.children.type !== 'node').map(c => h('option', { value: c.name }, c.name)));
    pane.append(h('div', { class: 'row' }, h('span', {}, name), h('div', { class: 'ctl col' },
      h('span', { class: 'slotv' }, cur ? (inner ? `<${inner}>` : rawShow(cur)) : 'leer'),
      pick,
      cur ? h('button', { type: 'button', class: 'btn sm', onclick: () => screenOp(n.ref, { op: 'setProp', id: el.id, name, value: null }) }, 'Leeren') : null)));
  }
}
function propRow(n, el, name, ps) {
  const cur = el.props.find(p => p.name === name);
  const key = `${el.id}:${name}`;
  const set = value => screenOp(n.ref, { op: 'setProp', id: el.id, name, value });
  const lit = literal(cur);
  const def = ps.default;
  const label = h('label', { for: key, title: ps.type || '' }, name, ps.required ? h('span', { class: 'req' }, ' *') : null);
  const reset = cur && lit.ok && !ps.required && ps.type !== 'handler'
    ? h('button', { type: 'button', class: 'reset', title: def !== undefined ? `Zurück auf Standard (${def})` : 'Zurücksetzen', 'aria-label': `${name} zurücksetzen`, onclick: () => set(null) }, '↺')
    : null;
  let ctl;
  if (cur && !lit.ok) ctl = h('span', { class: 'code', title: 'Datenbindung oder Ausdruck – im Code ändern' }, `{${cur.raw}}`);
  else if (ps.type === 'handler') ctl = h('span', { class: 'code' }, cur ? rawShow(cur) : '—');
  else if (ps.enum && ps.enum.length <= 5 && ps.enum.map(String).join('').length <= 34) {
    const val = lit.value;
    ctl = h('div', { class: 'segctl', role: 'group', id: key, 'aria-label': name }, ...ps.enum.map(o => {
      const on = val !== undefined && String(val) === String(o);
      const isDef = val === undefined && def !== undefined && String(def) === String(o);
      return h('button', {
        type: 'button', class: isDef ? 'def' : null, 'aria-pressed': String(on), title: isDef ? 'Standard (nicht gesetzt)' : null,
        onclick: () => { if (!on) set(typeof ps.enum[0] === 'number' ? Number(o) : o); },
      }, String(o));
    }));
  } else if (ps.enum) {
    ctl = h('select', { id: key, 'data-key': key, onchange: ev => { const v = ev.target.value; set(v === '' ? null : typeof ps.enum[0] === 'number' ? Number(v) : v); } },
      h('option', { value: '' }, def !== undefined ? `Standard: ${def}` : 'Nicht gesetzt'), ...ps.enum.map(o => h('option', { value: String(o), selected: lit.value !== undefined && String(lit.value) === String(o) }, String(o))));
  } else if (ps.type === 'boolean') {
    const on = lit.value === true;
    ctl = h('button', { type: 'button', role: 'switch', class: 'switch', id: key, 'aria-checked': String(on), 'aria-label': name, onclick: () => set(on ? null : true) }, h('i'));
  } else if (ps.type === 'string' || ps.type === 'number') {
    ctl = h('input', { type: ps.type === 'number' ? 'number' : 'text', id: key, 'data-key': key, placeholder: def !== undefined ? `Standard: ${def}` : 'Nicht gesetzt' });
    ctl.value = lit.value === undefined ? '' : String(lit.value);
    ctl.addEventListener('change', () => { const v = ctl.value; set(v === '' ? null : ps.type === 'number' ? Number(v) : v); });
    ctl.addEventListener('keydown', e => { if (e.key === 'Enter') ctl.blur(); });
  } else if (/\[\]$/.test(ps.type || '')) {
    const strList = ps.type === 'string[]';
    ctl = h('textarea', { id: key, 'data-key': key, rows: '3', title: strList ? 'Ein Eintrag pro Zeile' : 'JSON', placeholder: 'Nicht gesetzt' });
    ctl.value = lit.value === undefined ? '' : strList && Array.isArray(lit.value) ? lit.value.join('\n') : JSON.stringify(lit.value);
    ctl.addEventListener('change', () => {
      const t = ctl.value.trim();
      if (!t) return set(null);
      if (strList) return set(t.split('\n').map(s => s.trim()).filter(Boolean));
      try { set(JSON.parse(t)); } catch { toast('Kein gültiges JSON', 'bad'); }
    });
  } else ctl = h('span', { class: 'code' }, cur ? rawShow(cur) : '—');
  if (ctl.classList?.contains('segctl')) return h('div', { class: 'row stack' }, h('div', { class: 'rlabel' }, label, reset), ctl);
  return h('div', { class: 'row' }, label, h('div', { class: 'ctl' }, ctl, reset));
}

// ---------- Style: nur Tokens – sichtbar machen, was das Design System liefert ----------
const swCtx = document.createElement('canvas').getContext('2d');
function toHex(v) {
  if (!v || v === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(v)) return null;
  swCtx.fillStyle = '#000000';
  swCtx.fillStyle = v;
  return String(swCtx.fillStyle).toLowerCase();
}
const normFont = v => String(v).replace(/["']/g, '').replace(/\s*,\s*/g, ',').trim().toLowerCase();
function tokenIndex(win, doc) {
  const root = win.getComputedStyle(doc.documentElement);
  const idx = { color: new Map(), dim: new Map(), font: new Map(), weight: new Map() };
  const add = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  for (const t of S.data.ds.tokens) {
    const v = root.getPropertyValue(`--${t.path.replace(/\./g, '-')}`).trim();
    if (!v) continue;
    if (t.type === 'color') { const hx = toHex(v); if (hx) add(idx.color, hx, t.path); }
    else if (/^-?[\d.]+px$/.test(v)) add(idx.dim, String(parseFloat(v)), t.path);
    else if (t.type === 'fontFamily' || /^font\.family/.test(t.path)) add(idx.font, normFont(v), t.path);
    else if (t.type === 'fontWeight' || /^font\.weight/.test(t.path)) add(idx.weight, String(parseFloat(v)), t.path);
  }
  return idx;
}
function effectiveBg(el, win) {
  for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
    const c = win.getComputedStyle(node).backgroundColor;
    if (toHex(c)) return { value: c, inherited: node !== el };
  }
  return { value: 'rgb(255, 255, 255)', inherited: true };
}
function luminance(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(hex);
  if (!m) return null;
  const [r, g, b] = m.slice(1).map(x => { const v = parseInt(x, 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function computedLook(fr, id) {
  const win = fr?.iframe?.contentWindow;
  const doc = fr?.iframe?.contentDocument;
  let el = null;
  try { el = fr?.sb ? win?.__wfSb?.node(id) : doc?.querySelector(`[data-wf="${CSS.escape(id)}"]`); } catch { el = null; }
  if (!el || !win) return null;
  const cs = win.getComputedStyle(el);
  const idx = tokenIndex(win, doc);
  const rows = [];
  let untokened = 0;
  const color = (label, value) => {
    const hx = toHex(value);
    if (!hx) return;
    const tokens = idx.color.get(hx) || [];
    if (!tokens.length) untokened++;
    rows.push({ label, swatch: hx, tokens, value: hx });
  };
  const dim = (label, values, prefix) => {
    const px = [...new Set(values.map(v => parseFloat(v)).filter(v => v > 0))];
    if (!px.length) return;
    const tokens = px.map(p => (idx.dim.get(String(p)) || []).filter(t => !prefix || prefix.some(pre => t.startsWith(pre)))[0] || null);
    tokens.forEach(t => { if (!t) untokened++; });
    rows.push({ label, tokens: tokens.filter(Boolean), missing: tokens.some(t => !t), value: px.map(p => `${p}px`).join(' · ') });
  };
  const bg = effectiveBg(el, win);
  color(bg.inherited ? 'Fläche (geerbt)' : 'Fläche', bg.value);
  color('Text', cs.color);
  if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') color(`Rahmen ${parseFloat(cs.borderTopWidth)}px`, cs.borderTopColor);
  dim('Radius', [cs.borderTopLeftRadius], ['radius.']);
  dim('Innenabstand', [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft], ['space.']);
  if (/flex|grid/.test(cs.display)) dim('Abstand (gap)', [cs.rowGap], ['space.']);
  const fam = idx.font.get(normFont(cs.fontFamily)) || [];
  if (!fam.length) untokened++;
  rows.push({ label: 'Schrift', tokens: fam, missing: !fam.length, value: cs.fontFamily.split(',')[0].replace(/["']/g, '') });
  dim('Schriftgröße', [cs.fontSize], ['font.size.', 'font.']);
  rows.push({ label: 'Schriftstärke', tokens: idx.weight.get(String(parseFloat(cs.fontWeight))) || [], value: cs.fontWeight, quiet: true });
  let contrast = null;
  const text = el.textContent.trim();
  const fg = toHex(cs.color);
  const back = toHex(bg.value);
  if (text && fg && back && fg.startsWith('#') && back.startsWith('#')) {
    const a = luminance(fg);
    const b = luminance(back);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && parseFloat(cs.fontWeight) >= 700);
    contrast = { ratio, need: large ? 3 : 4.5, large };
  }
  return { rows, untokened, contrast };
}
function lookRow(r) {
  return h('div', { class: 'look' },
    h('span', { class: 'll' }, r.label),
    h('span', { class: 'lt' },
      r.swatch ? h('i', { class: 'sw', style: `background:${r.swatch}` }) : null,
      ...r.tokens.map(t => h('code', { class: 'tok' }, t)),
      r.missing || (!r.tokens.length && !r.quiet) ? h('span', { class: 'tag warn', title: 'Dieser Wert kommt nicht aus einem Token – Hinweis fürs Design-System-Team.' }, 'kein Token') : null,
      h('small', {}, r.value)));
}
function tokenScaleRow(n, el, name, ps) {
  const cur = el.props.find(p => p.name === name);
  const lit = literal(cur);
  const toks = S.data.ds.tokens.filter(t => !ps.group || t.path.startsWith(`${ps.group}.`));
  const set = value => screenOp(n.ref, { op: 'setProp', id: el.id, name, value });
  const reset = cur && lit.ok ? h('button', { type: 'button', class: 'reset', title: ps.default ? `Zurück auf Standard (${ps.default})` : 'Zurücksetzen', 'aria-label': `${name} zurücksetzen`, onclick: () => set(null) }, '↺') : null;
  const ctl = cur && !lit.ok
    ? h('span', { class: 'code' }, `{${cur.raw}}`)
    : h('div', { class: 'segctl scale', role: 'group', 'aria-label': name }, ...toks.map(t => {
      const on = lit.value === t.path;
      const isDef = lit.value === undefined && ps.default === t.path;
      return h('button', { type: 'button', class: isDef ? 'def' : null, 'aria-pressed': String(on), title: `${t.path} · ${t.css}${isDef ? ' · Standard' : ''}`, onclick: () => { if (!on) set(t.path); } }, t.path.split('.').pop());
    }));
  return h('div', { class: 'row stack' }, h('div', { class: 'rlabel' }, h('label', { title: `${ps.group || 'token'}-Tokens` }, name, h('small', {}, ` · ${ps.group || 'token'}`)), reset), ctl);
}
function countInstances(name) {
  let count = 0;
  let screens = 0;
  for (const s of Object.values(S.data.screens)) {
    if (!s.tree) continue;
    let here = 0;
    walkTree(s.tree, x => { if (x.name === name) here++; });
    if (here) { count += here; screens++; }
  }
  return { count, screens };
}
function stylePane(pane, n, el, sp) {
  const fr = S.frames.get(n.id);
  const b = fr?.boxes?.[el.id];
  pane.append(h('div', { class: 'grp' }, 'Größe', h('em', {}, b ? `${b[2]} × ${b[3]} px` : '–')));
  const tokenProps = Object.entries(sp?.props || {}).filter(([, ps]) => ps.type === 'token');
  if (tokenProps.length) {
    pane.append(h('div', { class: 'grp' }, 'Abstände und Layout', h('em', {}, 'Tokens')));
    for (const [name, ps] of tokenProps) pane.append(tokenScaleRow(n, el, name, ps));
  }
  const look = computedLook(fr, el.id);
  pane.append(h('div', { class: 'grp' }, 'Aussehen', h('em', {}, `aus ${S.data.ds.name || 'dem Design System'}${S.fid === 'wireframe' ? ' · Wireframe' : ''}`)));
  if (!look) pane.append(h('p', { class: 'hint' }, 'Wird gerendert …'));
  else {
    pane.append(h('div', { class: 'looks' }, ...look.rows.map(lookRow)));
    if (look.contrast) {
      const ok = look.contrast.ratio >= look.contrast.need;
      pane.append(h('div', { class: `contrast ${ok ? 'ok' : 'bad'}` },
        h('b', {}, `Kontrast ${look.contrast.ratio.toFixed(2).replace('.', ',')} : 1`),
        h('span', {}, ok ? `erfüllt WCAG AA (${look.contrast.need.toString().replace('.', ',')} : 1${look.contrast.large ? ', großer Text' : ''})` : `zu gering – braucht ${look.contrast.need.toString().replace('.', ',')} : 1`)));
    }
    if (look.untokened) pane.append(h('p', { class: 'hint' }, `${look.untokened} Wert${look.untokened === 1 ? '' : 'e'} ohne Token – kommt aus der Komponente selbst, ein Hinweis fürs Design-System-Team.`));
  }
  deviationBlock(pane, n, el);
}
function deviationBlock(pane, n, el) {
  const { count, screens } = countInstances(el.name);
  const key = `${el.id}:abweichung`;
  pane.append(h('div', { class: 'grp' }, 'Anders gestalten'));
  pane.append(h('p', { class: 'hint' }, 'Freie Werte gibt es in Screens nicht – Aussehen kommt aus Props und Tokens. Soll es anders aussehen, wird daraus eine Variante oder ein Vorschlag fürs Design System.'));
  pane.append(h('div', { class: 'seg elseg', role: 'group', 'aria-label': 'Geltungsbereich' }, ...[['one', 'Nur dieses'], ['all', `Überall · ${count}× ${el.name}`]].map(([id, label]) => h('button', {
    type: 'button', 'aria-pressed': String(S.scope === id), onclick: () => { S.scope = id; renderRight(); },
  }, label))));
  pane.append(h('p', { class: 'hint' }, S.scope === 'all'
    ? `Betrifft ${count} ${el.name} in ${screens} Screens – eine Änderung am Design System. Claude bereitet einen Vorschlag fürs DS-Team vor, statt das Paket direkt zu ändern.`
    : `Nur ${el.id}: Claude löst es mit Props, Tokens oder einer anderen Komponente – oder schlägt eine neue Variante von ${el.name} vor.`));
  const ta = h('textarea', { class: 'full', 'data-key': key, rows: '2', placeholder: 'Was soll anders aussehen? z. B. „weniger Gewicht“, „mehr Luft nach oben“' });
  const go = () => {
    const wish = ta.value.trim();
    if (!wish) { ta.focus(); return; }
    ta.value = '';
    const text = S.scope === 'all'
      ? `Vorschlag für das Design System: ${el.name} soll überall anders aussehen – „${wish}“. Betroffen: ${count} Instanzen in ${screens} Screens. Ändere das DS-Paket nicht direkt. Formuliere einen Vorschlag fürs DS-Team (Begründung, betroffene Tokens oder Varianten, Folgen für Barrierefreiheit), trage ihn als Lücke ins Manifest ein (gaps) und fasse ihn per canvas_reply zusammen.`
      : `Gestaltungswunsch für ${el.name} ${el.id} in „${n.title || n.id}“ (${n.ref}): „${wish}“ – nur dieses Element. Löse es mit dem Design System: passende Prop, Variante, Token oder eine andere DS-Komponente (screen_edit). Gibt das DS es nicht her, keine freien Werte: schlag eine neue Variante oder ein Prop für ${el.name} vor und dokumentiere die Lücke. Antworte per canvas_reply.`;
    askClaude(text, 'stil');
  };
  pane.append(ta, h('div', { class: 'btns' }, btn('An Claude', go, !S.chat.connected, 'pri'), !S.chat.connected ? h('span', { class: 'hint' }, 'Braucht den Canvas aus Claude Code (/wireflow:canvas).') : null));
}

// ---------- Änderungsliste mit Rückgängig je Eintrag ----------
function changesBlock(pane) {
  const list = (S.data.changes || []).slice().reverse();
  if (!list.length) return;
  const n = nodeById(S.sel.node);
  const refTitle = ref => S.data.flows.flatMap(f => f.nodes).find(x => x.ref === ref)?.title || ref.replace(/^screens\//, '');
  const open = list.filter(c => !c.reverted).length;
  pane.append(h('div', { class: 'grp' }, `Änderungen · ${open}`, h('em', {}, h('button', { type: 'button', class: 'linkbtn', onclick: undo }, 'Rückgängig ⌘Z'))));
  pane.append(h('ul', { class: 'changes' }, ...list.slice(0, 8).map(c => h('li', { class: `${c.reverted ? 'rev' : ''}${n?.ref === c.ref ? ' here' : ''}` },
    h('div', { class: 'chl' }, h('span', {}, c.label), h('small', {}, `${refTitle(c.ref)} · ${c.by === 'Claude' ? '✦ Claude' : 'Canvas'}${c.reverted ? ' · rückgängig' : ''}`)),
    c.revertible ? h('button', { type: 'button', class: 'reset', title: 'Nur diese Änderung rückgängig machen', 'aria-label': `Rückgängig: ${c.label}`, onclick: () => revertOne(c.id) }, '×') : null))));
  pane.append(h('p', { class: 'hint' }, 'Gespeichert ist jede Änderung sofort als Code; × macht eine einzelne rückgängig.'));
}
async function revertOne(id) {
  try {
    const r = await api('/api/revert', { id });
    toast(`Rückgängig: ${r.label}`);
    scheduleReload(r.files || [], r.v);
  } catch (e) {
    toast(e.message, 'bad');
  }
}

// ---------- Canvas-Griffe: Komponente darunter einfügen, Verbindung ziehen ----------
function openPicker(cx, cy) {
  S.picker = { x: Math.min(cx, innerWidth - 260), y: Math.min(cy, innerHeight - 330), q: '' };
  renderPicker();
  setTimeout(() => $('#picker input')?.focus(), 20);
}
function closePicker() {
  if (!S.picker) return;
  S.picker = null;
  renderPicker();
}
function renderPicker() {
  let el = $('#picker');
  if (!S.picker) { el?.remove(); return; }
  if (!el) { el = h('div', { id: 'picker', class: 'picker', role: 'dialog', 'aria-label': 'Komponente einfügen' }); document.body.append(el); }
  el.style.left = `${S.picker.x}px`;
  el.style.top = `${S.picker.y}px`;
  const q = h('input', { type: 'search', placeholder: 'Komponente einfügen …', 'aria-label': 'Komponente suchen' });
  q.value = S.picker.q;
  const list = h('div', { class: 'plist' });
  const fillList = () => {
    const terms = S.picker.q.toLowerCase().split(/\s+/).filter(Boolean);
    const cs = S.data.ds.components.filter(c => !terms.length || terms.every(t => [c.name, c.description, ...(c.intents || [])].join(' ').toLowerCase().includes(t)));
    fill(list, ...cs.slice(0, 12).map(c => h('button', { type: 'button', onclick: () => { closePicker(); insertComponent(c.name); } }, h('b', {}, c.name), c.description ? h('small', {}, c.description) : null)));
    if (!cs.length) list.append(h('p', { class: 'hint' }, 'Nichts gefunden – vielleicht eine DS-Lücke.'));
  };
  q.addEventListener('input', () => { S.picker.q = q.value; fillList(); });
  q.addEventListener('keydown', e => { if (e.key === 'Enter') list.querySelector('button')?.click(); if (e.key === 'Escape') closePicker(); });
  fillList();
  fill(el, q, list, h('p', { class: 'hint' }, `Wird nach der Auswahl eingefügt · ${S.data.ds.name || 'Design System'}`));
}
addEventListener('pointerdown', e => { if (S.picker && !e.target.closest?.('#picker')) closePicker(); }, true);

function startLinkDrag(e, fr, elId) {
  e.preventDefault();
  e.stopPropagation();
  const from = nodeById(fr.id);
  if (!from) return;
  const line = h('div', { class: 'linkline' });
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  const path = document.createElementNS(svgNS, 'path');
  svg.append(path);
  line.append(svg);
  document.body.append(line);
  const x0 = e.clientX;
  const y0 = e.clientY;
  let target = null;
  const mark = id => {
    if (target === id) return;
    if (target) S.nodeEls.get(target)?.classList.remove('linktarget');
    target = id;
    if (target) S.nodeEls.get(target)?.classList.add('linktarget');
  };
  beginPointer({
    move: ev => {
      const dx = Math.max(60, Math.abs(ev.clientX - x0) / 2);
      path.setAttribute('d', `M${x0},${y0} C${x0 + dx},${y0} ${ev.clientX - dx},${ev.clientY} ${ev.clientX},${ev.clientY}`);
      const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.node');
      const id = under?.dataset.node;
      mark(id && id !== fr.id && !id.startsWith('v:') ? id : null);
    },
    up: async () => {
      line.remove();
      const to = target;
      mark(null);
      if (!to) return;
      const scr = screenOf(from);
      const label = findEl(scr?.tree, elId)?.node.text || 'Weiter';
      const r = await flowOp({ op: 'connect', from: from.id, el: elId, to, label });
      if (r) toast(`Verbunden: ${elId} → ${nodeName(to)}${r.wired ? ' (flow.trigger im Code ergänzt)' : ''}`);
    },
  });
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

// ---------- Journey (Story Map) ----------
// Phasen → Schritte → Pain Points → Bedarfe | ab hier mit Produkt | Anforderungen → Screens.
// Arbeitskopie im Client, gespeichert über /api/journey (wireflow/journey@2). Eigene Rückgängig-Liste.
const J = { id: null, data: null, base: '', hist: [], fut: [], sel: null, edit: null, fresh: null, focus: null, pending: false, timer: 0, lint: true, drag: null, pre: null, refocus: false, saved: true };
const J_TERMS = [[/tipp/i, 'tippen', 'wählen, sich entscheiden'], [/klick/i, 'klicken', 'wählen, bestätigen'], [/button|knopf/i, 'Button', 'das Ziel dahinter'], [/screen|bildschirm|\bseite\b|maske/i, 'Screen', 'was dort erreicht wird'], [/formular|feld\b|felder/i, 'Feld', 'was angegeben wird'], [/dropdown|menü|popup|\bliste\b|filter/i, 'Bauteil', 'was gefunden oder entschieden wird'], [/eingeben|ausfüllen/i, 'eingeben', 'angeben, mitteilen'], [/\bslot/i, 'Slot', 'Termin, Zeit'], [/log ?in|anmelden|registrier/i, 'Login', 'sich ausweisen, nur wenn nötig'], [/\bapp\b|website|portal/i, 'App', 'offen lassen, wo es passiert']];
const J_TYPES = [
  ['info', 'Information', /\b(wissen|erkennen|verstehen|sehen|erfahren|nachvollziehen)\b/i, ['Vor der Wahl einer Praxis wissen, ob sie meine Versicherung annimmt.', 'Erkennen, dass mein Termin für mich zurückgehalten wird.']],
  ['ent', 'Entscheidung', /\b(vergleichen|auswählen|wählen|entscheiden|abwägen|einschätzen)\b/i, ['Praxen nach dem nächsten freien Termin vergleichen.', 'Einen Termin auswählen, der zu meinen Arbeitszeiten passt.']],
  ['hand', 'Handlung', /\b(angeben|ändern|korrigieren|erledigen|absagen|verschieben|mitteilen|bezahlen)\b/i, ['Angeben, wie ich versichert bin.', 'Einen Termin kurzfristig absagen oder verschieben.']],
];
const jTerm = t => { if (!J.lint) return null; for (const [r, w, b] of J_TERMS) if (r.test(t || '')) return { w, b }; return null; };
const jType = t => { let best = null, pos = Infinity; for (const [k, , r] of J_TYPES) { const m = (t || '').match(r); if (m && m.index < pos) { pos = m.index; best = k; } } return best; };
const jTypeLabel = k => J_TYPES.find(x => x[0] === k)?.[1];
const jUid = p => `${p}_${Math.random().toString(36).slice(2, 8)}`;
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).filter(y => y !== 'file').sort().map(y => [y, x[y]])) : x));
const jSnap = () => JSON.stringify(J.data);
const jSteps = () => J.data.phases.flatMap(p => p.steps);
const jPains = () => jSteps().flatMap(s => s.painPoints);
const jNeeds = () => jSteps().flatMap(s => s.needs);
const jPnum = p => `P${jPains().indexOf(p) + 1}`;
const jPain = id => jPains().find(p => p.id === id);
const jSolvers = p => jNeeds().filter(n => n.solves.includes(p.id));
const jInsight = id => S.data.knowledge.insights.find(i => i.id === id);
const jLevel = id => (id ? jInsight(id)?.wissensstand || 'offen' : null);
function jScreens() {
  const fl = S.data.flows.filter(f => f.journey === J.id);
  const list = (fl.length ? fl : S.data.flows).flatMap(f => f.nodes.filter(n => n.type === 'screen').map(n => ({ id: n.id, title: n.title || n.id, flow: f })));
  return list;
}
const jScreenTitle = id => jScreens().find(x => x.id === id)?.title || id;
function jLocate(id) {
  for (const [ai, a] of J.data.phases.entries()) {
    if (a.id === id) return { kind: 'act', a, ai };
    for (const [si, s] of a.steps.entries()) {
      if (s.id === id) return { kind: 'step', a, ai, s, si };
      for (const [pi, p] of s.painPoints.entries()) if (p.id === id) return { kind: 'pain', a, ai, s, si, p, pi };
      for (const [ni, n] of s.needs.entries()) {
        if (n.id === id) return { kind: 'need', a, ai, s, si, n, ni };
        for (const [ri, r] of n.requirements.entries()) if (r.id === id) return { kind: 'req', a, ai, s, si, n, ni, r, ri };
      }
    }
  }
  return null;
}
function jClean(j) {
  const d = JSON.parse(JSON.stringify(j));
  for (const p of d.phases) for (const s of p.steps) {
    for (const x of s.painPoints) if (!x.insight) delete x.insight;
    for (const n of s.needs) { if (!n.insight) delete n.insight; for (const r of n.requirements) if (!r.partial) delete r.partial; }
  }
  return d;
}

function jSync() {
  const list = S.data.journeys;
  const want = J.id && list.find(x => x.id === J.id) || list.find(x => x.id === flow()?.journey) || list[0];
  if (!want) { J.id = null; J.data = null; return 'none'; }
  const { file: _f, ...fresh } = want;
  if (J.id !== want.id || !J.data) {
    Object.assign(J, { id: want.id, data: JSON.parse(JSON.stringify(fresh)), base: canon(fresh), hist: [], fut: [], sel: null, edit: null });
    return 'reset';
  }
  if (!J.pending && canon(fresh) !== J.base) {
    Object.assign(J, { data: JSON.parse(JSON.stringify(fresh)), base: canon(fresh), hist: [], fut: [], edit: null });
    if (J.sel && !jLocate(J.sel)) J.sel = null;
    return 'reset';
  }
  return 'same';
}
function jSave() {
  J.saved = false;
  J.pending = true;
  jStat();
  clearTimeout(J.timer);
  J.timer = setTimeout(async () => {
    const body = jClean(J.data);
    try {
      const r = await api('/api/journey', { journey: body });
      J.base = canon(body);
      J.saved = true;
      J.pending = false;
      jStat();
      scheduleReload(r.files || [], r.v);
    } catch (e) {
      J.pending = false;
      toast(`Journey nicht gespeichert: ${e.message}`, 'bad');
      jStat();
    }
  }, 350);
}
function jChange(fn) { J.hist.push(jSnap()); if (J.hist.length > 100) J.hist.shift(); J.fut = []; fn(); jRender(); jSave(); }
function jUndo() { if (!J.hist.length) return; J.fut.push(jSnap()); J.data = JSON.parse(J.hist.pop()); J.edit = J.fresh = null; if (J.sel && !jLocate(J.sel)) J.sel = null; jRender(); jSave(); }
function jRedo() { if (!J.fut.length) return; J.hist.push(jSnap()); J.data = JSON.parse(J.fut.pop()); J.edit = J.fresh = null; if (J.sel && !jLocate(J.sel)) J.sel = null; jRender(); jSave(); }

function jAddAct(i) { jChange(() => { const a = { id: jUid('ph'), title: '', steps: [] }; J.data.phases.splice(i, 0, a); J.sel = J.edit = J.fresh = a.id; }); }
function jAddStep(a, i) { jChange(() => { const s = { id: jUid('st'), text: '', painPoints: [], needs: [] }; a.steps.splice(i, 0, s); J.sel = J.edit = J.fresh = s.id; }); }
function jAddPain(s) { jChange(() => { const p = { id: jUid('pp'), text: '' }; s.painPoints.push(p); J.sel = p.id; J.focus = 'jf-pain'; }); }
function jAddNeed(s) { jChange(() => { const n = { id: jUid('bd'), text: '', solves: [], requirements: [] }; s.needs.push(n); J.sel = n.id; J.focus = 'jf-need'; }); }
function jAddReq(n) { jChange(() => { const r = { id: jUid('an'), text: '', screens: [] }; n.requirements.push(r); J.sel = r.id; J.focus = 'jf-req'; }); }
function jDerive(id) { const L = jLocate(id); if (!L) return; jChange(() => { const n = { id: jUid('bd'), text: '', insight: L.p.insight, solves: [L.p.id], requirements: [] }; L.s.needs.push(n); J.sel = n.id; J.focus = 'jf-need'; }); toast(`Bedarf zu ${jPnum(L.p)} angelegt – Beleg übernommen.`); }
function jSibling(id) { const L = jLocate(id); if (L?.kind === 'act') jAddAct(L.ai + 1); else if (L?.kind === 'step') jAddStep(L.a, L.si + 1); }
function jRemove(id) {
  const L = jLocate(id);
  if (!L) return;
  const what = { act: () => `Phase „${L.a.title}“`, step: () => `Schritt „${L.s.text}“`, pain: () => `Pain Point ${jPnum(L.p)}`, need: () => `Bedarf B${L.ni + 1}`, req: () => 'Anforderung' }[L.kind]();
  jChange(() => {
    if (L.kind === 'act') J.data.phases.splice(L.ai, 1);
    else if (L.kind === 'step') L.a.steps.splice(L.si, 1);
    else if (L.kind === 'pain') L.s.painPoints.splice(L.pi, 1);
    else if (L.kind === 'need') L.s.needs.splice(L.ni, 1);
    else L.n.requirements.splice(L.ri, 1);
    const pains = new Set(jPains().map(p => p.id));
    for (const n of jNeeds()) n.solves = n.solves.filter(x => pains.has(x));
    J.sel = null;
  });
  toast(`${what} gelöscht – ⌘Z macht es rückgängig.`);
}
function jMoveIn(list, from, item, toList, toI) { list.splice(from, 1); if (list === toList && from < toI) toI--; toList.splice(toI ?? toList.length, 0, item); }
function jMove(id, target, before) {
  const L = jLocate(id), T = target && jLocate(target);
  jChange(() => {
    if (L.kind === 'act') jMoveIn(J.data.phases, L.ai, L.a, J.data.phases, T.ai);
    else if (L.kind === 'step') { if (T.kind === 'act') jMoveIn(L.a.steps, L.si, L.s, T.a.steps, T.a.steps.length); else jMoveIn(L.a.steps, L.si, L.s, T.a.steps, T.si); }
    else if (L.kind === 'pain') jMoveIn(L.s.painPoints, L.pi, L.p, T.s.painPoints, T.kind === 'pain' ? T.pi : undefined);
    else if (L.kind === 'need') jMoveIn(L.s.needs, L.ni, L.n, T.s.needs, T.kind === 'need' ? T.ni : undefined);
  });
}
function jNudge(id, dir) {
  const L = jLocate(id);
  if (!L) return;
  J.refocus = true;
  const fs = jSteps(), k = L.s ? fs.indexOf(L.s) : -1;
  const lists = { act: [J.data.phases, L.ai, L.a], pain: [L.s?.painPoints, L.pi, L.p], need: [L.s?.needs, L.ni, L.n], req: [L.n?.requirements, L.ri, L.r] };
  if (L.kind === 'step') {
    if (dir === 'r') { if (L.si < L.a.steps.length - 1) jChange(() => jMoveIn(L.a.steps, L.si, L.s, L.a.steps, L.si + 2)); else if (J.data.phases[L.ai + 1]) jChange(() => jMoveIn(L.a.steps, L.si, L.s, J.data.phases[L.ai + 1].steps, 0)); }
    if (dir === 'l') { if (L.si > 0) jChange(() => jMoveIn(L.a.steps, L.si, L.s, L.a.steps, L.si - 1)); else if (J.data.phases[L.ai - 1]) jChange(() => jMoveIn(L.a.steps, L.si, L.s, J.data.phases[L.ai - 1].steps)); }
    return;
  }
  const [list, i, item] = lists[L.kind];
  const step = L.kind === 'act' ? (dir === 'r' ? 1 : dir === 'l' ? -1 : 0) : (dir === 'd' ? 1 : dir === 'u' ? -1 : 0);
  if (step) { const j = i + step; if (j >= 0 && j < list.length) jChange(() => { list.splice(i, 1); list.splice(j, 0, item); }); return; }
  if ((L.kind === 'pain' || L.kind === 'need') && (dir === 'l' || dir === 'r')) {
    const to = fs[k + (dir === 'r' ? 1 : -1)];
    if (to) jChange(() => jMoveIn(list, i, item, L.kind === 'pain' ? to.painPoints : to.needs));
  }
}

function jFinish(ta, o, field, keep, next) {
  if (ta._done) return;
  ta._done = true;
  const v = ta.value.replace(/\s+/g, ' ').trim(), wasFresh = J.fresh === o.id;
  J.edit = J.fresh = null;
  J.refocus = true;
  if (!keep || !v) { if (wasFresh) { J.data = JSON.parse(J.hist.pop()); J.sel = null; jSave(); } jRender(); return; }
  if (v !== o[field]) { if (!wasFresh) { J.hist.push(jSnap()); J.fut = []; } o[field] = v; jSave(); }
  if (next) jSibling(o.id); else jRender();
}
function jCard(kind, o, body, extra) {
  const field = kind === 'act' ? 'title' : 'text';
  const isEdit = J.edit === o.id, L = J.sel && jLocate(J.sel);
  const rel = L && ((kind === 'req' && L.kind === 'need' && L.n.requirements.includes(o)) || (kind === 'need' && L.kind === 'req' && L.n === o) || (kind === 'pain' && L.kind === 'need' && L.n.solves.includes(o.id)) || (kind === 'need' && L.kind === 'pain' && o.solves.includes(L.p.id)));
  const label = { act: 'Phase', step: 'Schritt', pain: 'Pain Point', need: 'Bedarf', req: 'Anforderung' }[kind];
  const inline = kind === 'act' || kind === 'step';
  const el = h('div', {
    class: `jc jc-${kind}${J.sel === o.id ? ' sel' : ''}${rel ? ' rel' : ''}`, tabindex: '0', role: 'button', draggable: isEdit || kind === 'req' ? null : 'true', 'data-jid': o.id, 'aria-label': `${label}: ${o[field] || 'leer'}`,
    onclick: e => { if (e.target.closest('button,textarea')) return; J.sel = o.id; jRender(); },
    ondblclick: e => { if (e.target.closest('button') || !inline) return; J.sel = J.edit = o.id; jRender(); },
    onkeydown: e => {
      if (e.target.tagName === 'TEXTAREA') return;
      const ar = { ArrowLeft: 'l', ArrowRight: 'r', ArrowUp: 'u', ArrowDown: 'd' };
      if (e.altKey && ar[e.key]) { e.preventDefault(); e.stopPropagation(); J.sel = o.id; jNudge(o.id, ar[e.key]); }
      else if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); J.sel = o.id; if (inline) J.edit = o.id; else J.focus = { pain: 'jf-pain', need: 'jf-need', req: 'jf-req' }[kind]; jRender(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); jRemove(o.id); }
    },
    ondragstart: e => { J.drag = { kind, id: o.id }; e.dataTransfer.setData('text/plain', o.id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); },
    ondragend: () => { J.drag = null; el.classList.remove('dragging'); },
  });
  if (isEdit) {
    const ta = h('textarea', { 'aria-label': label, rows: '2', placeholder: kind === 'act' ? 'Phase, z. B. Praxis finden' : 'Was wollen Menschen erreichen?' });
    ta.value = o[field];
    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); jFinish(ta, o, field, true); }
      else if (e.key === 'Tab') { e.preventDefault(); jFinish(ta, o, field, true, true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); jFinish(ta, o, field, false); }
    });
    ta.addEventListener('blur', () => jFinish(ta, o, field, true));
    el.append(ta);
    requestAnimationFrame(() => { ta.focus(); ta.select(); });
  } else el.append(...body.filter(Boolean));
  if (extra && !isEdit) el.append(...[].concat(extra).filter(Boolean));
  el.append(h('button', { type: 'button', class: 'jx', title: 'Löschen', 'aria-label': `${label} löschen`, onclick: e => { e.stopPropagation(); jRemove(o.id); } }, '×'));
  const accepts = d => d && d.id !== o.id && (d.kind === kind || (kind === 'act' && d.kind === 'step'));
  el.addEventListener('dragover', e => { if (!accepts(J.drag)) return; e.preventDefault(); e.stopPropagation(); el.classList.add('over'); });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', e => { el.classList.remove('over'); if (!accepts(J.drag)) return; e.preventDefault(); e.stopPropagation(); const d = J.drag; J.drag = null; jMove(d.id, o.id); });
  return el;
}
const jChip = (cls, text, title) => h('span', { class: `jchip ${cls}`, title }, text);
function jEvidence(id) {
  if (!id) return jChip('k-annahme', 'Annahme', 'Ohne Beleg – Kandidat für /wireflow:research');
  const i = jInsight(id), lv = i?.wissensstand || 'offen';
  return jChip(`k-${lv}`, `${KLABEL[lv] || lv} · ${id}`, i ? `${i.aussage}${i.fakten?.length ? ` (${i.fakten.join(', ')})` : ''}` : 'Insight nicht gefunden');
}
function jStepCard(s, a, si) {
  const t = jTerm(s.text);
  const ins = (side, at) => h('button', { type: 'button', class: `jins jins-${side}`, title: 'Schritt einfügen', 'aria-label': `Schritt ${side === 'l' ? 'vor' : 'nach'} „${s.text}“ einfügen`, onclick: e => { e.stopPropagation(); jAddStep(a, at); } }, '+');
  return jCard('step', s, [h('span', {}, s.text), t ? h('div', {}, jChip('lint', `Lösung? ${t.w}`, `„${t.w}“ beschreibt eine Lösung. Besser: ${t.b}`)) : null], [si === 0 ? ins('l', 0) : null, ins('r', si + 1)]);
}
function jPainCard(p) {
  const sv = jSolvers(p);
  return jCard('pain', p, [h('div', { class: 'jnum' }, jPnum(p)), h('span', {}, p.text),
    h('div', { class: 'jmeta' }, p.insight ? jEvidence(p.insight) : jChip('k-offen', 'ohne Beleg'), sv.length ? jChip('solv', `→ ${sv.map(n => { const N = jLocate(n.id); return `B${N.ni + 1}${N.s === jLocate(p.id).s ? '' : ` (${N.s.text})`}`; }).join(', ')}`) : jChip('gap', 'kein Bedarf'))],
  h('button', { type: 'button', class: 'jderive', title: 'Bedarf aus diesem Pain Point ableiten', onclick: e => { e.stopPropagation(); jDerive(p.id); } }, '→ B'));
}
function jNeedCard(n, i) {
  const ty = jType(n.text), t = jTerm(n.text);
  return jCard('need', n, [h('div', { class: 'jnum' }, `B${i + 1}`), h('span', {}, n.text),
    h('div', { class: 'jmeta' }, ty ? jChip(`t-${ty}`, jTypeLabel(ty)) : null, jEvidence(n.insight),
      n.solves.length ? jChip('solv', `löst ${n.solves.map(jPain).filter(Boolean).map(jPnum).join(', ')}`) : null,
      t ? jChip('lint', `Lösung? ${t.w}`, `„${t.w}“ klingt nach Lösung. Besser: ${t.b}`) : null)]);
}
function jReqCard(r) {
  const scr = jScreens();
  return jCard('req', r, [h('span', {}, r.text || '(leer)'), h('div', { class: 'jmeta' },
    r.screens.length ? r.screens.map(id => { const x = scr.find(y => y.id === id); return h('button', { type: 'button', class: 'jscr', title: x ? `Im Flow „${x.flow.title}“ öffnen` : 'Screen nicht gefunden', onclick: e => { e.stopPropagation(); if (!x) return; S.flowId = x.flow.id; setMode('design'); select({ node: id }); centerOn(id); } }, h('i'), x?.title || id); }) : jChip('gap', 'kein Screen'),
    r.partial ? jChip('part', 'teilweise', r.partial) : null)]);
}
function jStack(kind, s, items, add, addLabel) {
  const el = h('div', { class: 'jstack' }, items, h('button', { type: 'button', class: `jghost${kind === 'pain' ? ' sm' : ''}`, onclick: add }, addLabel));
  el.addEventListener('dragover', e => { if (J.drag?.kind !== kind) return; e.preventDefault(); el.classList.add('over'); });
  el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('over'); });
  el.addEventListener('drop', e => { el.classList.remove('over'); if (J.drag?.kind !== kind) return; e.preventDefault(); const d = J.drag; J.drag = null; jMove(d.id, s.id); });
  return el;
}

function jMap() {
  const b = $('#jboard');
  if (!b || !J.data) return;
  const wall = b.parentElement, sx = wall.scrollLeft, sy = wall.scrollTop;
  b.textContent = '';
  let col = 2;
  const tpl = ['var(--jlab)'];
  const pos = J.data.phases.map(a => { const n = Math.max(1, a.steps.length), p = { c: col, n }; col += n; for (let i = 0; i < n; i++) tpl.push('var(--jcw)'); return p; });
  tpl.push('var(--jcw)');
  b.style.gridTemplateColumns = tpl.join(' ');
  const place = (el, c, r, span = 1) => { el.style.gridColumn = `${c} / span ${span}`; el.style.gridRow = r; b.append(el); };
  place(h('div', { class: 'jlab' }, 'Phasen'), 1, 1);
  place(h('div', { class: 'jlab' }, 'Schritte'), 1, 2);
  place(h('div', { class: 'jlab' }, 'Pain Points', h('small', {}, 'mit Beleg')), 1, 3);
  place(h('div', { class: 'jlab' }, 'Bedarfe', h('small', {}, 'was Menschen brauchen')), 1, 4);
  place(h('div', { class: 'jrule' }, 'ab hier mit Produkt'), 1, 5, col);
  place(h('div', { class: 'jlab sys' }, 'Anforderungen', h('small', {}, 'ans Produkt, mit Screens')), 1, 6);
  J.data.phases.forEach((a, ai) => {
    place(jCard('act', a, [h('span', {}, a.title)]), pos[ai].c, 1, pos[ai].n);
    if (!a.steps.length) {
      const g = h('button', { type: 'button', class: 'jghost', onclick: () => jAddStep(a, 0) }, '+ Schritt');
      g.addEventListener('dragover', e => { if (J.drag?.kind === 'step') e.preventDefault(); });
      g.addEventListener('drop', e => { if (J.drag?.kind !== 'step') return; e.preventDefault(); const d = J.drag; J.drag = null; jMove(d.id, a.id); });
      place(g, pos[ai].c, 2);
    }
    a.steps.forEach((s, si) => {
      const c = pos[ai].c + si;
      place(jStepCard(s, a, si), c, 2);
      place(jStack('pain', s, s.painPoints.map(jPainCard), () => jAddPain(s), '+ Pain Point'), c, 3);
      place(jStack('need', s, s.needs.map(jNeedCard), () => jAddNeed(s), '+ Bedarf'), c, 4);
      place(h('div', { class: 'jstack' }, s.needs.map((n, i) => h('div', { class: 'jrg' }, h('div', { class: 'jnum' }, `zu B${i + 1}`),
        n.requirements.length ? n.requirements.map(jReqCard) : h('div', { class: 'jmiss' }, 'Noch keine Anforderung'),
        h('button', { type: 'button', class: 'jghost sm', onclick: () => jAddReq(n), 'aria-label': `Anforderung zu B${i + 1}` }, '+ Anforderung')))), c, 6);
    });
  });
  place(h('button', { type: 'button', class: 'jghost', onclick: () => jAddAct(J.data.phases.length) }, '+ Phase'), col, 1);
  wall.scrollLeft = sx;
  wall.scrollTop = sy;
  if (J.refocus && J.sel && !J.edit) b.querySelector(`[data-jid="${J.sel}"]`)?.focus({ preventScroll: false });
  J.refocus = false;
}
function jGaps() {
  const out = [];
  for (const p of jPains()) if (!jSolvers(p).length) out.push([p.id, `${jPnum(p)} „${p.text}“`, 'noch kein Bedarf dazu']);
  for (const a of J.data.phases) for (const s of a.steps) {
    const t = jTerm(s.text);
    if (t) out.push([s.id, `„${s.text}“`, `klingt nach Lösung (${t.w})`]);
    if (!s.needs.length) out.push([s.id, `„${s.text}“`, 'hat noch keine Bedarfe']);
    s.needs.forEach((n, i) => {
      const lab = `${s.text}, B${i + 1}`, nt = jTerm(n.text);
      if (nt) out.push([n.id, lab, `klingt nach Lösung (${nt.w})`]);
      if (!n.insight) out.push([n.id, lab, 'ohne Beleg (Annahme)']);
      if (!n.requirements.length) out.push([n.id, lab, 'noch keine Anforderung']);
      for (const r of n.requirements) { if (!r.screens.length) out.push([r.id, lab, 'Anforderung ohne Screen']); else if (r.partial) out.push([r.id, lab, `nur teilweise gelöst: ${r.partial}`]); }
    });
  }
  return out;
}
function jStat() {
  const el = $('#jstat');
  if (!el || !J.data) return;
  const ns = jNeeds();
  const gaps = ns.filter(n => !n.requirements.length).length + ns.flatMap(n => n.requirements).filter(r => !r.screens.length).length + jPains().filter(p => !jSolvers(p).length).length;
  fill(el, `${jSteps().length} Schritte · ${jPains().length} Pain Points · ${ns.length} Bedarfe, ${ns.filter(n => n.insight).length} belegt`, gaps ? h('b', {}, ` · ${gaps} Lücken`) : null, h('span', { class: 'jsave' }, J.pending ? ' · speichert …' : J.saved ? ' · gespeichert' : ''));
  const u = $('#jundo'), r = $('#jredo');
  if (u) u.disabled = !J.hist.length;
  if (r) r.disabled = !J.fut.length;
}

let jLive = () => {};
function jBind(el, get, set) {
  el.value = get() ?? '';
  el.addEventListener('focus', () => { J.pre = jSnap(); });
  el.addEventListener('input', () => { set(el.value); jMap(); jStat(); jLive(); jSave(); });
  el.addEventListener('change', () => { if (J.pre && J.pre !== jSnap()) { J.hist.push(J.pre); J.fut = []; jStat(); } J.pre = null; });
  return el;
}
const jFld = (label, ctl, hint) => h('label', { class: 'jfld' }, label, ctl, hint ? h('small', {}, hint) : null);
function jInsightSelect(id, get, set, none) {
  return jBind(h('select', { id }, h('option', { value: '' }, none), S.data.knowledge.insights.map(i => h('option', { value: i.id }, `${i.id} · ${KLABEL[i.wissensstand] || i.wissensstand} · ${i.aussage}`))), get, v => set(v || undefined));
}
function jInsp() {
  const p = $('#jinsp');
  if (!p) return;
  jLive = () => {};
  const L = J.sel && jLocate(J.sel);
  const del = h('button', { type: 'button', class: 'btn danger', onclick: () => jRemove(J.sel) }, 'Löschen');
  const btns = (...b) => h('div', { class: 'btns' }, ...b, del);
  if (!L) {
    const j = J.data, items = jGaps();
    fill(p, h('div', { class: 'jkind' }, 'Journey'),
      jFld('Titel', jBind(h('input', { id: 'jf-title' }), () => j.title, v => { j.title = v; })),
      h('div', { class: 'jrow2' }, jFld('Persona', jBind(h('input', { id: 'jf-persona' }), () => j.persona, v => { j.persona = v; })), jFld('Art', jBind(h('select', { id: 'jf-variant' }, h('option', { value: 'ist' }, 'Ist'), h('option', { value: 'soll' }, 'Soll')), () => j.variant || 'ist', v => { j.variant = v; }))),
      jFld('Szenario', jBind(h('textarea', { id: 'jf-scenario', rows: '2' }), () => j.scenario, v => { j.scenario = v; })),
      h('h3', {}, `Offene Punkte (${items.length})`),
      h('p', { class: 'hint' }, 'Annahmen sind kein Fehler, aber Kandidaten für /wireflow:research.'),
      h('ul', { class: 'jtodo' }, items.slice(0, 60).map(([id, lab, t]) => h('li', {}, h('button', { type: 'button', onclick: () => { J.sel = id; J.refocus = true; jRender(); } }, lab, ': ', h('b', {}, t))))));
    return;
  }
  if (L.kind === 'act') {
    const f = L.a.flow && S.data.flows.find(x => x.id === L.a.flow);
    fill(p, h('div', { class: 'jkind' }, 'Phase'), jFld('Titel', jBind(h('input', { id: 'jf-act' }), () => L.a.title, v => { L.a.title = v; })),
      (L.a.opportunities || []).length ? h('div', { class: 'jfld' }, 'Chancen', h('ul', {}, L.a.opportunities.map(o => h('li', {}, o)))) : null,
      btns(h('button', { type: 'button', class: 'btn', onclick: () => jAddStep(L.a, L.a.steps.length) }, '+ Schritt'), f ? h('button', { type: 'button', class: 'btn', onclick: () => { S.flowId = f.id; setMode('design'); } }, `Flow „${f.title}“ öffnen`) : null));
    return;
  }
  if (L.kind === 'step') {
    const s = L.s, box = h('div', {});
    jLive = () => { const t = jTerm(s.text); fill(box, t ? h('p', { class: 'hint' }, `„${t.w}“ klingt nach Lösung. Besser: ${t.b}.`) : null); };
    fill(p, h('div', { class: 'jkind' }, `Schritt in „${L.a.title}“`), jFld('Was wollen Menschen erreichen?', jBind(h('input', { id: 'jf-step' }), () => s.text, v => { s.text = v; })), box,
      h('h3', {}, `Pain Points (${s.painPoints.length}) · Bedarfe (${s.needs.length})`),
      h('ul', { class: 'jtodo' }, s.painPoints.map(x => h('li', {}, h('button', { type: 'button', onclick: () => { J.sel = x.id; jRender(); } }, `${jPnum(x)}: ${x.text}`))), s.needs.map((n, i) => h('li', {}, h('button', { type: 'button', onclick: () => { J.sel = n.id; jRender(); } }, `B${i + 1}: ${n.text}`)))),
      btns(h('button', { type: 'button', class: 'btn', onclick: () => jAddPain(s) }, '+ Pain Point'), h('button', { type: 'button', class: 'btn', onclick: () => jAddNeed(s) }, '+ Bedarf')));
    jLive();
    return;
  }
  if (L.kind === 'pain') {
    const x = L.p, sv = jSolvers(x);
    fill(p, h('div', { class: 'jkind' }, `Pain Point ${jPnum(x)} bei „${L.s.text}“`),
      jFld('Was geht schief?', jBind(h('textarea', { id: 'jf-pain', rows: '3', placeholder: 'z. B. Termin beim Absenden weg, Angaben verloren' }), () => x.text, v => { x.text = v; }), 'Aus Sicht der Menschen, ohne Lösung'),
      jFld('Beleg', jInsightSelect('jf-pins', () => x.insight, v => { x.insight = v; }, 'ohne Beleg')),
      h('h3', {}, sv.length ? `Gelöst durch (${sv.length})` : 'Noch kein Bedarf'),
      h('ul', { class: 'jtodo' }, sv.map(n => { const N = jLocate(n.id); return h('li', {}, h('button', { type: 'button', onclick: () => { J.sel = n.id; jRender(); } }, `B${N.ni + 1} (${N.s.text}): ${n.text}`)); })),
      btns(h('button', { type: 'button', class: 'btn', onclick: () => jDerive(x.id) }, 'Bedarf ableiten')));
    return;
  }
  if (L.kind === 'need') {
    const n = L.n, info = h('div', { 'aria-live': 'polite' });
    const aps = L.a.steps.flatMap(s => s.painPoints);
    jLive = () => { const ty = jType(n.text), t = jTerm(n.text); fill(info, h('div', { class: 'jmeta' }, ty ? jChip(`t-${ty}`, jTypeLabel(ty)) : jChip('k-offen', 'Art nicht erkannt'), t ? jChip('lint', `Lösung? ${t.w}`, `Besser: ${t.b}`) : null)); };
    fill(p, h('div', { class: 'jkind' }, `Bedarf B${L.ni + 1} bei „${L.s.text}“`),
      jFld('Was brauchen Menschen?', jBind(h('textarea', { id: 'jf-need', rows: '3', placeholder: 'z. B. Wissen, bis wann ich kostenlos absagen kann.' }), () => n.text, v => { n.text = v; })), info,
      h('details', { class: 'jhelp', open: !n.text }, h('summary', {}, 'Beispiele'), J_TYPES.map(([k, lab, , ex]) => h('div', {}, jChip(`t-${k}`, lab), h('ul', {}, ex.map(e => h('li', {}, e))))), h('p', { class: 'hint' }, 'Aus Sicht der Menschen, mit einem Verb. Ein „um …“ oder „weil …“ hilft, ist aber kein Muss.')),
      jFld('Beleg', jInsightSelect('jf-nins', () => n.insight, v => { n.insight = v; }, 'kein Beleg, als Annahme führen')),
      h('div', { class: 'jfld' }, `Löst Pain Points in „${L.a.title}“`, aps.length ? h('div', { class: 'jchecks' }, aps.map(x => { const c = h('input', { type: 'checkbox' }); c.checked = n.solves.includes(x.id); c.addEventListener('change', () => jChange(() => { n.solves = c.checked ? [...n.solves, x.id] : n.solves.filter(y => y !== x.id); })); return h('label', {}, c, `${jPnum(x)} ${x.text}`); })) : h('span', { class: 'hint' }, 'Keine Pain Points in dieser Phase')),
      h('h3', {}, n.requirements.length ? `Anforderungen (${n.requirements.length})` : 'Noch keine Anforderung'),
      h('ul', { class: 'jtodo' }, n.requirements.map(r => h('li', {}, h('button', { type: 'button', onclick: () => { J.sel = r.id; jRender(); } }, r.text || '(leer)')))),
      btns(h('button', { type: 'button', class: 'btn', onclick: () => jAddReq(n) }, '+ Anforderung')));
    jLive();
    return;
  }
  const r = L.r, scr = jScreens(), multi = new Set(scr.map(x => x.flow.id)).size > 1;
  fill(p, h('div', { class: 'jkind' }, `Anforderung zu B${L.ni + 1}`), h('p', { class: 'hint' }, L.n.text),
    jFld('Was muss das Produkt ermöglichen?', jBind(h('textarea', { id: 'jf-req', rows: '3', placeholder: 'z. B. Bei jeder Praxis den nächsten freien Termin sehen.' }), () => r.text, v => { r.text = v; })),
    h('div', { class: 'jfld' }, 'Screens', scr.length ? h('div', { class: 'jchecks' }, scr.map(x => { const c = h('input', { type: 'checkbox' }); c.checked = r.screens.includes(x.id); c.addEventListener('change', () => jChange(() => { r.screens = c.checked ? [...r.screens, x.id] : r.screens.filter(y => y !== x.id); })); return h('label', {}, c, multi ? `${x.flow.title} › ${x.title}` : x.title); })) : h('span', { class: 'hint' }, 'Noch kein Flow mit Screens.')),
    jFld('Nur teilweise gelöst?', jBind(h('input', { id: 'jf-part', placeholder: 'z. B. nur im Profil, nicht in der Übersicht' }), () => r.partial, v => { r.partial = v || undefined; })),
    btns(h('button', { type: 'button', class: 'btn', onclick: () => { J.sel = L.n.id; jRender(); } }, '← Zum Bedarf')));
}
function jRender() {
  jMap();
  jInsp();
  jStat();
  if (J.focus) { const f = $(`#${J.focus}`); J.focus = null; if (f) { f.focus(); const n = f.value?.length || 0; f.setSelectionRange?.(n, n); } }
}

function renderJourney() {
  const doc = $('#doc');
  if (!S.data.journeys.length) { fill(doc, h('div', { class: 'empty' }, h('div', {}, h('b', {}, 'Noch keine Journey'), 'In Claude Code: /wireflow:journey – aus Research, Interviews oder dem, was das Team weiß.'))); J.id = null; return; }
  const st = jSync();
  if (st === 'same' && doc.querySelector(`.jroot[data-j="${J.id}"]`)) { if (!J.edit) jMap(); jStat(); return; }
  const j = J.data;
  const sel = S.data.journeys.length > 1 ? h('select', { 'aria-label': 'Journey', onchange: e => { J.id = e.target.value; J.data = null; renderJourney(); } }, S.data.journeys.map(x => h('option', { value: x.id, selected: x.id === J.id || null }, x.title || x.id))) : null;
  const lint = h('input', { type: 'checkbox', id: 'jlint' });
  lint.checked = J.lint;
  lint.addEventListener('change', () => { J.lint = lint.checked; jRender(); });
  fill(doc, h('div', { class: 'jroot', 'data-j': J.id },
    h('div', { class: 'jhead' },
      h('div', { class: 'jtitle' }, h('h1', {}, j.title || j.id), h('p', { class: 'sub' }, [j.variant === 'soll' ? 'Soll-Journey' : 'Ist-Journey', j.persona, j.scenario].filter(Boolean).join(' · '))),
      h('div', { class: 'jbar', role: 'toolbar', 'aria-label': 'Story Map bearbeiten' }, sel,
        h('button', { type: 'button', class: 'btn', id: 'jundo', title: '⌘Z', onclick: jUndo }, '↶ Rückgängig'),
        h('button', { type: 'button', class: 'btn', id: 'jredo', title: '⌘⇧Z', onclick: jRedo }, '↷ Wiederholen'),
        h('button', { type: 'button', class: 'btn', onclick: () => jAddAct(J.data.phases.length) }, '+ Phase'),
        h('label', { class: 'btn' }, lint, 'Lösungsbegriffe'),
        h('span', { class: 'jstat', id: 'jstat', 'aria-live': 'polite' }))),
    h('div', { class: 'jbody' }, h('div', { class: 'jwall' }, h('div', { class: 'jboard', id: 'jboard' })), h('aside', { class: 'jinsp', id: 'jinsp', 'aria-label': 'Eigenschaften' }))));
  jRender();
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

// ---------- Chat: Gespräch mit der laufenden Claude-Code-Sitzung ----------
const MODE_LABEL = { strict: 'Strikt', guided: 'Geführt', free: 'Frei', original: 'Original' };
const MODE_HINT = {
  strict: 'nur Komponenten, Props und Tokens des Design Systems, Patterns einhalten, Aufbau nah am Original – Verbesserungen im Detail.',
  guided: 'Komponenten des Design Systems; Aufbau, Hierarchie und Gewichtung frei neu denken; Patterns und belegte Insights als Leitplanke.',
  free: 'kreativ und mutig explorieren, auch ungewöhnliche Lösungen; Lücken im Design System sind erlaubt, aber im Begründungssatz zu nennen.',
};
const chatTabLabel = () => (S.chat.unread ? `Chat · ${S.chat.unread}` : 'Chat');
function updateChatTab() {
  const b = $('#right .tabs [data-tab="chat"]');
  if (b) b.textContent = chatTabLabel();
}
function selectionMeta() {
  const n = nodeById(S.sel.node);
  if (isSb(n)) return sbMeta(n);
  if (!n) return { flow: S.flowId };
  const scr = screenOf(n);
  const el = scr && S.sel.el && !S.sel.variant ? findEl(scr.tree, S.sel.el)?.node : null;
  const out = { flow: S.flowId, knoten: n.id, titel: n.title || n.label || n.id, screen: S.sel.variant || n.ref || '', variante: S.sel.variant || '', zustand: n.story || scr?.stories?.[0] || '', element: el?.id || '', komponente: el?.name || '' };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v));
}
function selectionLabel() {
  const n = nodeById(S.sel.node);
  if (!n) return null;
  if (S.sel.variant) return `${n.title || n.id} · Variante`;
  if (isSb(n)) { const el = S.sel.el ? findEl(sbScreen(n).tree, S.sel.el)?.node : null; return el ? `${el.name} · ${n.title}` : `Story ${n.title}`; }
  const scr = screenOf(n);
  const el = scr && S.sel.el ? findEl(scr.tree, S.sel.el)?.node : null;
  return el ? `${el.name} · ${el.id}` : n.title || n.label || n.id;
}
function onChat(m) {
  const list = S.chat.messages;
  const i = list.findIndex(x => x.id === m.id);
  if (i >= 0) list[i] = { ...list[i], ...m };
  else list.push(m);
  if (list.length > 400) list.splice(0, list.length - 400);
  if (m.role === 'activity' && m.ref) markWorking(m.ref);
  if (m.role === 'claude' && i < 0 && (S.rightTab !== 'chat' || S.mode === 'prototype')) {
    S.chat.unread++;
    toast('Claude hat im Chat geantwortet.', 'ai');
  }
  if (S.mode === 'prototype') return;
  if (S.rightTab === 'chat') renderRight();
  else updateChatTab();
}
function markWorking(ref) {
  S.working.set(ref, Date.now());
  for (const fr of S.frames.values()) if (fr.ref === ref) fr.el?.classList.add('working');
  clearTimeout(markWorking.timer);
  markWorking.timer = setTimeout(() => {
    const now = Date.now();
    for (const [r, t] of S.working) if (now - t > 5000) S.working.delete(r);
    for (const fr of S.frames.values()) fr.el?.classList.toggle('working', S.working.has(fr.ref));
  }, 5200);
}
async function sendChat(text, kind) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (!S.chat.connected) {
    toast('Kein Claude verbunden – den Canvas in Claude Code mit /wireflow:canvas öffnen.', 'warn');
    return false;
  }
  try {
    const r = await api('/api/chat', { text: t, selection: kind || S.chat.attach ? selectionMeta() : null, kind: kind || null });
    onChat(r.message);
    return true;
  } catch (e) {
    toast(e.message, 'bad');
    return false;
  }
}
// Auftrag aus Kontextmenü oder Lückenkarte: im Chat sichtbar, an Claude geschickt.
async function askClaude(text, kind) {
  S.rightTab = 'chat';
  S.chat.unread = 0;
  const ok = await sendChat(text, kind);
  renderRight();
  if (ok) setTimeout(() => { if (S.rightTab === 'chat') renderRight(); }, 16000);
}
function mdLite(text) {
  const inline = s => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  return esc(text).split(/\n{2,}/).map(b => {
    const lines = b.split('\n');
    if (lines.every(l => /^\s*[-*]\s+/.test(l))) return `<ul>${lines.map(l => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`;
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('');
}
function chatItem(m) {
  const time = new Date(m.time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (m.role === 'activity') return h('div', { class: 'cact', title: time }, '⋯ ', m.text);
  if (m.role === 'claude') {
    const body = h('div', { class: 'cbody' });
    body.innerHTML = mdLite(m.text);
    return h('div', { class: 'cmsg claude' }, h('div', { class: 'cwho' }, '✦ Claude ', h('small', {}, time)), body);
  }
  const a = m.meta || {};
  const where = [a.titel, a.element].filter(Boolean).join(' · ');
  return h('div', { class: 'cmsg user' }, h('div', { class: 'cbody' }, m.text), h('div', { class: 'cmeta' }, where ? `${where} · ` : '', `${time} · ${m.status || ''}`));
}
function chatPane(pane) {
  const c = S.chat;
  const via = S.data.delivery;
  const viaInfo = {
    monitor: ['Monitor', 'Der Plugin-Monitor „canvas-chat“ stellt Nachrichten sofort zu.'],
    kanal: ['Kanal oder nächster Schritt', 'Kein Monitor aktiv (braucht Claude Code ab 2.1.310, nicht mit -p). Mit Kanal (claude --dangerously-load-development-channels plugin:wireflow@awesome-uxe) kommen Nachrichten sofort an, sonst beim nächsten Schritt.'],
    hooks: ['nächster Schritt', 'Kein Monitor aktiv – Claude liest Nachrichten beim nächsten Prompt im Terminal oder am Ende des laufenden Schritts.'],
  }[via];
  pane.append(h('div', { class: 'chathead' },
    c.connected
      ? h('span', { class: 'pill', title: viaInfo?.[1] || '' }, h('i'), h('span', {}, 'Claude Code verbunden'))
      : h('span', { class: 'pill off' }, h('i'), h('span', {}, 'Ohne Claude-Sitzung')),
    c.connected && viaInfo ? h('small', { class: `hint via ${via}`, title: viaInfo[1] }, `Zustellung: ${viaInfo[0]}`) : null));
  const list = h('div', { class: 'chatlist', role: 'log', 'aria-live': 'polite' });
  if (!c.messages.length) {
    list.append(h('p', { class: 'hint' }, c.connected
      ? 'Frag Claude zur Auswahl – oder nutze das Kontextmenü (Rechtsklick auf einen Screen oder ein Element, Taste .): Varianten, Review, Zustände, Weiter.'
      : 'Dieser Canvas läuft ohne Claude-Sitzung (wireflow serve). Öffne ihn in Claude Code mit /wireflow:canvas – dann gehen Nachrichten direkt an Claude.'));
  }
  for (const m of c.messages) list.append(chatItem(m));
  const last = [...c.messages].reverse().find(m => m.role === 'user');
  if (last && last.status === 'gesendet' && Date.now() - Date.parse(last.time) > 15000 && !c.messages.some(m => m.role !== 'user' && Date.parse(m.time) > Date.parse(last.time))) {
    list.append(h('div', { class: 'chatnote' }, 'Claude hat noch nicht reagiert. Sofort zugestellt wird über den Plugin-Monitor „canvas-chat“ (Claude Code ab 2.1.310, interaktiv – nicht mit -p) oder den Kanal ', h('code', {}, 'claude --dangerously-load-development-channels plugin:wireflow@awesome-uxe'), '. Sonst liest Claude die Nachricht beim nächsten Schritt – schreib im Terminal zum Beispiel „weiter“.'));
  }
  const sel = selectionLabel();
  const chip = !sel ? null : c.attach
    ? h('span', { class: 'chip' }, `Auswahl: ${sel}`, h('button', { type: 'button', 'aria-label': 'Auswahl nicht mitsenden', onclick: () => { c.attach = false; renderRight(); } }, '×'))
    : h('button', { type: 'button', class: 'chip off', onclick: () => { c.attach = true; renderRight(); } }, `+ Auswahl: ${sel}`);
  const ta = h('textarea', { 'data-key': 'chat:input', rows: '3', 'aria-label': 'Nachricht an Claude', placeholder: c.connected ? 'Nachricht an Claude … (Enter sendet, Umschalt+Enter: neue Zeile)' : 'Nicht verbunden' });
  ta.disabled = !c.connected;
  const go = async () => {
    const t = ta.value;
    if (!t.trim()) return;
    ta.value = '';
    if (!(await sendChat(t))) ta.value = t;
    renderRight();
  };
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); go(); } });
  pane.append(list, h('div', { class: 'composer' }, chip, ta, h('div', { class: 'btns' }, btn('Senden', go, !c.connected, 'pri'))));
  requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
}

// ---------- Code: das Screen-Modul hinter der Auswahl ----------
function syntax(s) {
  return s
    .replace(/(&quot;.*?&quot;|&#39;.*?&#39;|`[^`]*`)/g, '<span class="st">$1</span>')
    .replace(/\b(import|from|export|function|return|const|type|default|satisfies)\b(?![^<]*<\/span>)/g, '<span class="kw">$1</span>')
    .replace(/(&lt;\/?)([A-Z][\w.]*)/g, '$1<span class="tg">$2</span>')
    .replace(/\bdata-wf=/g, '<span class="wf">data-wf</span>=');
}
function codePane(pane) {
  const n = nodeById(S.sel.node);
  if (isSb(n)) { sbCodePane(pane, n); return; }
  if (flow()?.storybook) { pane.append(h('p', { class: 'hint' }, 'Story auswählen – hier stehen ihr Stories-File, die Komponente und die Datei des gewählten Elements.')); return; }
  const ref = n?.type === 'screen' ? S.sel.variant || n.ref : null;
  if (!ref) {
    pane.append(h('p', { class: 'hint' }, 'Screen auswählen – hier steht sein Code: das Screen-Modul aus Komponenten des Design Systems und seine Zustände als Stories.'));
    return;
  }
  const key = `${ref}@${S.dataV}`;
  const d = S.codeCache.get(key);
  if (!d) {
    pane.append(h('p', { class: 'hint' }, 'Lade Code …'));
    api(`/api/source?ref=${encodeURIComponent(ref)}`).then(x => { S.codeCache.set(key, x); if (S.rightTab === 'code') renderRight(); }).catch(e => toast(e.message, 'bad'));
    return;
  }
  const sub = d.stories ? S.codeSub : 'screen';
  const src = sub === 'stories' ? d.stories : d.source;
  const hl = sub === 'screen' && S.sel.el && !S.sel.variant ? d.lines[S.sel.el] : null;
  const pre = h('pre', { class: 'codeview', tabindex: '0', 'aria-label': `Quelltext ${sub === 'stories' ? d.storiesFile : d.file}` });
  src.split('\n').forEach((line, i) => {
    const row = document.createElement('div');
    row.className = `cl${hl && i + 1 >= hl[0] && i + 1 <= hl[1] ? ' on' : ''}`;
    row.innerHTML = `<span class="ln">${i + 1}</span>${syntax(esc(line)) || ' '}`;
    pre.append(row);
  });
  pane.append(
    h('div', { class: 'ihead' }, h('code', {}, sub === 'stories' ? d.storiesFile : d.file)),
    d.stories ? h('div', { class: 'seg sub', role: 'group', 'aria-label': 'Datei' }, ...[['screen', 'Screen'], ['stories', 'Zustände (Stories)']].map(([id, l]) => h('button', { type: 'button', 'aria-pressed': String(sub === id), onclick: () => { S.codeSub = id; renderRight(); } }, l))) : null,
    pre,
    h('p', { class: 'hint' }, 'Der Canvas schreibt diesen Code; Änderungen im Editor oder durch Claude erscheinen sofort im Canvas.'),
  );
  requestAnimationFrame(() => pre.querySelector('.cl.on')?.scrollIntoView({ block: 'center' }));
}

// ---------- Varianten neben dem Original ----------
function variantRects(f) {
  const out = [];
  if (!f) return out;
  const taken = f.nodes.map(n => nodeRect(n));
  for (const n of f.nodes) {
    const vs = n.variants || [];
    if (!vs.length) continue;
    const r = nodeRect(n);
    const w = vs.length * (VW() + 60) - 60;
    const hit = yy => taken.some(t => t.x < r.x + w + 40 && t.x + t.w > r.x - 40 && t.y < yy + VH() + 80 && t.y + t.h > yy - 80);
    let y = r.y + r.h + 170;
    for (let guard = 0; hit(y) && guard < 30; guard++) y += 200;
    vs.forEach((v, i) => {
      const rect = { x: r.x + i * (VW() + 60), y, w: VW(), h: VH() };
      taken.push(rect);
      out.push({ n, v, rect, key: `v:${n.id}:${v.ref}` });
    });
  }
  return out;
}
function createVariant(key, nodeId, ref) {
  const title = h('div', { class: 'ftitle' });
  const ov = h('div', { class: 'ov' });
  const box = h('div', { class: 'frame' }, ov);
  const el = h('div', { class: 'node scr var' }, title, box);
  const fr = { id: key, variantOf: nodeId, ref, story: '', v: S.dataV, url: '', iframe: null, next: null, boxes: {}, h: VH(), box, ov, title, el, failed: false };
  S.frames.set(key, fr);
  const pick = e => { if (e.button !== 0) return; e.stopPropagation(); select({ node: nodeId, variant: ref }); };
  title.addEventListener('pointerdown', pick);
  ov.addEventListener('pointerdown', pick);
  const menu = e => { e.preventDefault(); e.stopPropagation(); select({ node: nodeId, variant: ref }); openMenu(e.clientX, e.clientY); };
  ov.addEventListener('contextmenu', menu);
  title.addEventListener('contextmenu', menu);
  return el;
}
function renderVariants(f) {
  const list = variantRects(f);
  const keep = new Set(list.map(x => x.key));
  for (const [key, el] of S.nodeEls) {
    if (key.startsWith('v:') && !keep.has(key)) { el.remove(); S.nodeEls.delete(key); S.frames.delete(key); }
  }
  for (const { n, v, rect, key } of list) {
    let el = S.nodeEls.get(key);
    if (!el) { el = createVariant(key, n.id, v.ref); world.append(el); S.nodeEls.set(key, el); }
    el.style.left = `${rect.x}px`;
    el.style.top = `${rect.y}px`;
    el.classList.toggle('sel', S.sel.node === n.id && S.sel.variant === v.ref);
    el.classList.toggle('working', S.working.has(v.ref));
    const fr = S.frames.get(key);
    fr.ref = v.ref;
    fr.story = n.story || '';
    const l = S.data.screens[v.ref]?.lint;
    fill(fr.title,
      h('span', { class: `tag ${v.mode === 'free' ? 'warn' : v.mode === 'original' ? '' : 'ai'}` }, `◇ ${MODE_LABEL[v.mode] || v.mode || 'Variante'}`),
      h('b', { title: v.rationale || '' }, v.label || 'Variante'),
      l ? h('span', { class: `tag ${l.errors.length ? 'bad' : l.score.pct < 100 ? 'warn' : 'ok'}` }, l.errors.length ? `${l.errors.length} Fehler` : `DS ${l.score.pct} %`) : null);
    fr.box.style.width = `${VW()}px`;
    fr.box.style.height = `${fr.h}px`;
    ensureIframe(fr);
  }
}
function variantInspector(pane, n, ref) {
  const v = (n.variants || []).find(x => x.ref === ref);
  if (!v) { screenInspector(pane, n); return; }
  const scr = S.data.screens[ref];
  const f = flow();
  pane.append(h('div', { class: 'ihead' }, h('h2', {}, v.label || 'Variante'), h('span', { class: `tag ${v.mode === 'free' ? 'warn' : v.mode === 'original' ? '' : 'ai'}` }, MODE_LABEL[v.mode] || v.mode || '')));
  pane.append(h('p', { class: 'hint' }, `Variante von „${n.title || n.id}“${v.by ? ` · von ${v.by}` : ''} · `, h('code', {}, `.wireflow/${ref}`)));
  if (v.rationale) pane.append(h('p', {}, v.rationale));
  const missing = f.edges.filter(e => e.from === n.id && e.el && !(scr?.tree && findEl(scr.tree, e.el))).map(e => e.el);
  if (missing.length) pane.append(msgList([{ msg: `Hotspots fehlen: ${missing.join(', ')} – nach dem Tauschen wären diese Verbindungen offen.`, level: 'warning' }]));
  pane.append(h('div', { class: 'btns' },
    btn('Tauschen', async () => { const r = await flowOp({ op: 'promoteVariant', id: n.id, ref }); if (r) select({ node: n.id }); }, false, 'pri'),
    btn('Verwerfen', async () => {
      if (!confirm(`Variante „${v.label || ref}“ verwerfen? Die Datei wird gelöscht (Rückgängig mit ⌘/Strg+Z).`)) return;
      const r = await flowOp({ op: 'discardVariant', id: n.id, ref });
      if (r) select({ node: n.id });
    }, false, 'danger'),
    btn('Code', () => { S.rightTab = 'code'; renderRight(); })));
  pane.append(h('p', { class: 'hint' }, 'Tauschen macht die Variante zum Screen im Flow; die bisherige Fassung bleibt als Variante erhalten.'));
  if (scr?.lint) {
    const l = scr.lint;
    pane.append(h('div', { class: 'grp' }, 'Design System', h('em', {}, `${l.score.pct} % aus ${S.data.ds.name || 'DS'}`)));
    pane.append(msgList([...l.errors.map(m => ({ msg: m.msg, level: 'error' })), ...l.warnings.map(m => ({ msg: m.msg, level: 'warning' }))], 'Keine Befunde.'));
  }
}

// ---------- Lücken als Karten am Ort ----------
function gapsOf(f) {
  const out = [];
  if (f?.storybook) return out;
  const slots = {};
  for (const iss of f.issues || []) {
    const n = nodeById(iss.ref);
    if (!n) continue;
    const r = nodeRect(n);
    const name = n.title || n.label || n.id;
    const slot = () => (slots[n.id] = (slots[n.id] || 0) + 1) - 1;
    if (iss.code === 'decision-no' || iss.code === 'decision-yes') {
      const no = iss.code === 'decision-no';
      const label = no ? 'Nein' : 'Ja';
      const when = no ? 'else' : n.var || 'true';
      const p = port(n, no ? 'b' : 'r');
      const q = { x: p.x + p.nx * 150, y: p.y + p.ny * 150 };
      out.push({ level: 'warn', at: q, anchor: no ? 'top' : 'left', stub: [p, q], title: `${label}-Pfad fehlt`, text: `„${n.label}“ = ${label}: Wohin geht es?`, actions: [
        ['Mit Claude entwerfen', () => askClaude(`Entwirf den ${label}-Pfad für die Entscheidung „${n.label}“ (${n.id}) im Flow „${f.title}“: Lege mit flow_edit addScreen einen passenden Screen aus Komponenten des Design Systems an (Patterns beachten – bei Fehlern mit Weg zurück, Eingaben bleiben erhalten), gestalte ihn und verbinde ihn mit flow_edit connect (from: "${n.id}", when: "${when}", label: "${label}").`, 'luecke')],
        ['Screen anlegen', () => newScreenFor(n, label, when)],
      ] });
    } else if (iss.code === 'dead-end') {
      out.push({ level: 'info', at: { x: r.x + r.w + 36, y: r.y + 60 + slot() * 150 }, anchor: 'left', title: 'Führt nirgendwohin', text: `„${name}“ hat keinen Ausgang.`, actions: [
        ['Mit Claude weiterführen', () => askClaude(`„${name}“ (${n.ref}) hat im Flow „${f.title}“ keinen Ausgang. Schlag vor, wie es weitergeht – oder ob es ein Ausstieg ist – und setze es um: Interaktion im Screen, Ziel-Screen mit flow_edit addScreen, Verbindung mit flow_edit connect.`, 'luecke')],
        ['Ist Ausstieg', () => flowOp({ op: 'setNode', id: n.id, props: { exit: true } })],
      ] });
    } else if (iss.code === 'unreachable') {
      out.push({ level: 'warn', at: { x: r.x - 36, y: r.y + 60 }, anchor: 'right', title: 'Nicht erreichbar', text: `Kein Weg vom Einstieg zu „${name}“.`, actions: [
        ['Verbinden …', () => { select({ node: n.id }); toast('In einem anderen Screen ein Element wählen und unter „Interaktion“ hierher verbinden.'); }],
      ] });
    } else if (iss.code === 'hotspot') {
      out.push({ level: 'bad', at: { x: r.x + r.w + 36, y: r.y + 60 + slot() * 150 }, anchor: 'left', title: 'Hotspot fehlt im Code', text: iss.message, actions: [
        ['Mit Claude reparieren', () => askClaude(`${iss.message} Stelle die Verbindung im Screen wieder her (data-wf-ID und flow.trigger) oder passe den Flow an.`, 'luecke')],
      ] });
    } else if (iss.code === 'screen') {
      out.push({ level: 'bad', at: { x: r.x + r.w / 2, y: r.y + 120 }, anchor: 'top', title: 'Screen fehlt', text: iss.message, actions: [
        ['Mit Claude anlegen', () => askClaude(`${iss.message} Lege das Screen-Modul ${n.ref} aus Komponenten des Design Systems an.`, 'luecke')],
      ] });
    }
  }
  return out;
}
function gapCard(g) {
  return h('div', { class: `gapcard ${g.level} a-${g.anchor}`, role: 'group', 'aria-label': g.title, style: `left:${g.at.x}px;top:${g.at.y}px`, onpointerdown: ev => ev.stopPropagation() },
    h('b', {}, g.title),
    h('p', {}, g.text),
    h('div', { class: 'gbtns' }, ...g.actions.map(([label, fn], i) => h('button', { type: 'button', class: i === 0 ? 'pri' : '', onclick: fn }, label))));
}

// ---------- Kontextmenü (radial) ----------
function selectionCenter() {
  const { n, hit } = selected();
  if (!n) return null;
  const fr = S.frames.get(S.sel.variant ? `v:${n.id}:${S.sel.variant}` : n.id);
  if (!fr?.box) return null;
  const r = fr.box.getBoundingClientRect();
  if (hit && !S.sel.variant && fr.boxes[hit.node.id]) {
    const b = fr.boxes[hit.node.id];
    const s = r.width / (fr.w || VW());
    return { x: r.left + (b[0] + b[2] / 2) * s, y: r.top + (b[1] + b[3] / 2) * s };
  }
  return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 220) };
}
function openMenu(cx, cy) {
  const n = nodeById(S.sel.node);
  if (!n || (n.type !== 'screen' && !isSb(n)) || S.mode !== 'design') return;
  const pad = 200;
  S.menu = { x: Math.max(pad, Math.min(innerWidth - pad, cx)), y: Math.max(pad - 30, Math.min(innerHeight - pad + 30, cy)), open: null };
  renderMenu();
  $('#radial .ritem')?.focus();
}
function closeMenu() {
  if (!S.menu) return;
  S.menu = null;
  renderMenu();
}
async function nextScreen(targetId) {
  const { n, hit } = selected();
  if (!n) return;
  const el = hit && hit.parent && spec(hit.node.name)?.handler ? hit.node.id : null;
  const label = (hit && hit.parent && hit.node.text) || 'Weiter';
  if (targetId) {
    const r = await flowOp({ op: 'connect', from: n.id, el, to: targetId, label });
    if (r) toast(`Verbunden: ${el || n.title || n.id} → ${nodeName(targetId)}`);
    return;
  }
  const title = prompt('Titel des neuen Screens', 'Neuer Screen');
  if (!title) return;
  const pos = freeSpotRight(n);
  const a = await flowOp({ op: 'addScreen', title, ...pos });
  if (a?.node) {
    await flowOp({ op: 'connect', from: n.id, el, to: a.node, label });
    select({ node: a.node });
    setTimeout(() => centerOn(a.node), 150);
  }
}
function freeSpotRight(n) {
  const r = nodeRect(n);
  const rects = flow().nodes.filter(x => x !== n).map(nodeRect).concat(variantRects(flow()).map(v => v.rect));
  const x = r.x + r.w + 160;
  let y = r.y;
  const hit = yy => rects.some(t => t.x < x + VW() + 60 && t.x + t.w > x - 60 && t.y < yy + VH() + 60 && t.y + t.h > yy - 60);
  for (let i = 0; hit(y) && i < 30; i++) y += VH() + 200;
  return { x: Math.round(x / 10) * 10, y: Math.round(y / 10) * 10 };
}
function reviewItems(subject) {
  const personas = [...new Set(S.data.journeys.map(j => j.persona).filter(Boolean))];
  const journeyOf = p => S.data.journeys.find(j => j.persona === p);
  const ask = (text, kind) => () => askClaude(text, kind);
  return [
    ...personas.slice(0, 3).map(p => ({
      label: `Persona: ${p.length > 24 ? `${p.slice(0, 23)}…` : p}`,
      title: p,
      run: ask(`Review ${subject} aus Sicht der Persona „${p}“${journeyOf(p) ? ` aus der Journey „${journeyOf(p).title}“` : ''}: Geh den Screen mit ihren Zielen, dem Szenario, den Pain Points und den belegten Insights durch. Antworte mit Befunden (blockiert / sollte / könnte) und konkreten Vorschlägen per canvas_reply – ändere nichts. Ein Persona-Walkthrough ist keine Evidenz.`, 'review'),
    })),
    { label: 'Heuristiken', run: ask(`Review ${subject} nach den Heuristiken von Nielsen und den Richtlinien des Design Systems. Befunde (blockiert / sollte / könnte) mit Vorschlag per canvas_reply – ändere nichts.`, 'review') },
    { label: 'Barrierefreiheit', run: ask(`Prüfe ${subject} auf Barrierefreiheit nach WCAG 2.2 (Beschriftungen, Reihenfolge, Zielgrößen, Kontrast über Tokens, Fehlermeldungen) und die A11y-Hinweise des Manifests. Befunde per canvas_reply – ändere nichts.`, 'review') },
    { label: 'Texte', run: ask(`Review der Texte in ${subject}: Sprache der Nutzer:innen, Klarheit, Länge, Buttons als Verben, Fehlermeldungen mit Ausweg. Schlag bessere Texte vor (per canvas_reply) – ändere nichts.`, 'review') },
    { label: 'Design System', run: ask(`Prüfe ${subject} gegen das Design System: passende Komponenten und Patterns, Richtlinien, Regeln, Lücken. Befunde per canvas_reply – ändere nichts.`, 'review') },
  ];
}
function menuItems() {
  const { n, hit } = selected();
  if (isSb(n)) return sbMenuItems(n, hit);
  const f = flow();
  const title = n.title || n.id;
  const elInfo = hit && hit.parent && !S.sel.variant ? ` – mit Fokus auf ${hit.node.id} <${hit.node.name}>` : '';
  const ref = S.sel.variant || n.ref;
  const toCode = () => { S.rightTab = 'code'; renderRight(); };
  const toChat = () => {
    S.rightTab = 'chat';
    S.chat.attach = true;
    S.chat.unread = 0;
    renderRight();
    setTimeout(() => $('#right [data-key="chat:input"]')?.focus(), 30);
  };
  const ask = (text, kind) => () => askClaude(text, kind);
  const reviewSub = reviewItems(`„${title}“ (${ref})${elInfo}`);
  if (S.sel.variant) {
    return [
      { id: 'swap', label: 'Tauschen', icon: '⇄', angle: -90, run: async () => { const r = await flowOp({ op: 'promoteVariant', id: n.id, ref: S.sel.variant }); if (r) select({ node: n.id }); } },
      { id: 'drop', label: 'Verwerfen', icon: '✕', angle: 30, run: async () => {
        if (!confirm('Variante verwerfen? Die Datei wird gelöscht (Rückgängig mit ⌘/Strg+Z).')) return;
        const r = await flowOp({ op: 'discardVariant', id: n.id, ref: S.sel.variant });
        if (r) select({ node: n.id });
      } },
      { id: 'code', label: 'Code', icon: '</>', angle: 90, run: toCode },
      { id: 'chat', label: 'Chat', icon: '✦', angle: 150, run: toChat },
      { id: 'review', label: 'Review', icon: '◎', angle: 210, sub: reviewSub },
    ];
  }
  const hot = f.edges.filter(e => e.from === n.id && e.el).map(e => e.el);
  const variants = mode => `Erzeuge 2 Varianten von „${title}“ (${n.ref})${elInfo} im Modus ${MODE_LABEL[mode]}: ${MODE_HINT[mode]} Behalte die Hotspot-IDs ${hot.length ? hot.join(', ') : '(keine)'} bei. Lege jede Variante mit variant_create an (mode: "${mode}") und nenne den Unterschied in einem Satz.`;
  const others = f.nodes.filter(x => x.id !== n.id && x.type === 'screen').slice(0, 4);
  return [
    { id: 'variants', label: 'Varianten', icon: '▦', angle: -90, sub: ['strict', 'guided', 'free'].map(mode => ({ label: MODE_LABEL[mode], title: MODE_HINT[mode], run: ask(variants(mode), 'varianten') })) },
    { id: 'next', label: 'Weiter', icon: '→', angle: -30, sub: [{ label: '+ Neuer Screen', run: () => nextScreen(null) }, ...others.map(x => ({ label: `→ ${x.title || x.id}`, run: () => nextScreen(x.id) }))] },
    { id: 'states', label: 'Zustände', icon: '◫', angle: 30, sub: ['Leer', 'Fehler', 'Laden', 'Erstnutzung', 'Offline'].map(z => ({ label: z, run: ask(`Lege für „${title}“ (${n.ref}) den Zustand „${z}“ als Story im Stories-File an – passend zu den Patterns des Design Systems und mit realistischen Fixture-Daten. Ergänze Props im Screen nur, wenn nötig, und sag kurz per canvas_reply, was der Zustand zeigt.`, 'zustand') })) },
    { id: 'code', label: 'Code', icon: '</>', angle: 90, run: toCode },
    { id: 'chat', label: 'Chat', icon: '✦', angle: 150, run: toChat },
    { id: 'review', label: 'Review', icon: '◎', angle: 210, sub: reviewSub },
  ];
}
function renderMenu() {
  let el = $('#radial');
  if (!S.menu) { el?.remove(); return; }
  if (!el) { el = h('div', { id: 'radial', class: 'radial', role: 'menu', 'aria-label': 'Kontextmenü' }); document.body.append(el); }
  const { x, y, open } = S.menu;
  const parts = [h('div', { class: 'rhub', style: `left:${x}px;top:${y}px` })];
  for (const it of menuItems()) {
    const a = (it.angle * Math.PI) / 180;
    parts.push(h('button', {
      type: 'button',
      role: 'menuitem',
      class: `ritem${open === it.id ? ' on' : ''}`,
      style: `left:${x + Math.cos(a) * 84}px;top:${y + Math.sin(a) * 84}px`,
      'aria-haspopup': it.sub ? 'true' : null,
      'aria-expanded': it.sub ? String(open === it.id) : null,
      onclick: () => {
        if (it.sub) { S.menu.open = open === it.id ? null : it.id; renderMenu(); $('#radial .rpill')?.focus(); } else { closeMenu(); it.run(); }
      },
    }, h('span', { class: 'ri', 'aria-hidden': 'true' }, it.icon), h('span', { class: 'rl' }, it.label)));
    if (open === it.id && it.sub) {
      const k = it.sub.length;
      const spread = Math.min(24, 150 / Math.max(1, k - 1));
      it.sub.forEach((s, i) => {
        const b = ((it.angle + (i - (k - 1) / 2) * spread) * Math.PI) / 180;
        parts.push(h('button', { type: 'button', role: 'menuitem', class: 'rpill', title: s.title || '', style: `left:${x + Math.cos(b) * 172}px;top:${y + Math.sin(b) * 172}px`, onclick: () => { closeMenu(); s.run(); } }, s.label));
      });
    }
  }
  fill(el, ...parts);
}
addEventListener('pointerdown', e => { if (S.menu && !e.target.closest?.('#radial')) closeMenu(); }, true);

// ---------- Storybook als Renderer ----------
// Das Storybook-Brett zeigt die Stories des Projekts als Frames – gerendert von Storybook
// selbst (mit Decorators, Providern und Styles des Projekts). Nichts wird migriert: Args
// lassen sich live ändern, Komponenten auswählen und prüfen; Änderungen am Code macht Claude.
const SB_GAP_X = 90;
const SB_GAP_Y = 70;
const SB_PER_ROW = 8;
const SB_COMP_W = 360;
const leaf = t => String(t || '').split('/').pop().trim();
const sbKey = () => `wireflow-sb:${S.data?.project?.name || location.port}`;
function sbLoadPrefs() {
  try {
    const d = JSON.parse(localStorage.getItem(sbKey()) || '{}');
    S.sb.pins = new Set(Array.isArray(d.pins) ? d.pins : []);
    S.sb.pos = d.pos && typeof d.pos === 'object' ? d.pos : {};
  } catch { /* privat */ }
}
function sbSavePrefs() {
  try { localStorage.setItem(sbKey(), JSON.stringify({ pins: [...S.sb.pins], pos: S.sb.pos })); } catch { /* privat */ }
}
async function loadSb(refresh = false) {
  let d;
  try { d = await api(`/api/storybook${refresh ? '?refresh=1' : ''}`); } catch { return; }
  const first = !S.sb.loaded;
  const before = S.sb.flow?.nodes.length || 0;
  Object.assign(S.sb, { status: d.status, url: d.url, base: d.base || '', hash: d.hash, hint: d.hint || '', dirs: d.dirs || [], groups: d.groups || [], loaded: true });
  if (first) sbLoadPrefs();
  S.sb.flow = sbFlow();
  if (S.flowId === SB) {
    if (!before && S.sb.flow.nodes.length) S.fitted = false;
    validateSelection();
    renderAll();
  } else if (S.data) renderTop();
}
const sbH = (id, kind) => S.frames.get(id)?.h || (kind === 'component' ? 160 : VH());
function sbNode(g, s, kind, x, y, w) {
  const id = `sb:${s.id}`;
  const o = S.sb.pos[id];
  return { id, type: 'story', story: s.id, kind, group: g.title, file: g.file, component: g.component, name: s.name, exportName: s.exportName, title: `${leaf(g.title)} · ${s.name}`, x: o ? o.x : x, y: o ? o.y : y, w };
}
// Screens nebeneinander (je Komponente eine Spalte, ihre Zustände darunter), Komponenten-Stories darunter.
function sbFlow() {
  const nodes = [];
  const screens = S.sb.groups.filter(g => g.screen);
  const comps = S.sb.groups.filter(g => !g.screen);
  const W = VW();
  let x = 0;
  let y = 0;
  let col = 0;
  let band = 0;
  for (const g of screens) {
    if (col === SB_PER_ROW) { col = 0; x = 0; y += band + SB_GAP_Y * 1.5; band = 0; }
    let yy = y;
    for (const s of g.stories) {
      nodes.push(sbNode(g, s, 'screen', x, yy, W));
      yy += sbH(`sb:${s.id}`, 'screen') + SB_GAP_Y;
    }
    band = Math.max(band, yy - y);
    x += W + SB_GAP_X;
    col++;
  }
  const list = screens.length
    ? comps.flatMap(g => g.stories.filter(s => S.sb.pins.has(s.id)).map(s => [g, s]))
    : comps.slice(0, 8).flatMap(g => g.stories.slice(0, 4).map(s => [g, s]));
  if (list.length) {
    y += screens.length ? band + SB_GAP_Y : 0;
    let title = null;
    let row = 0;
    for (const [g, s] of list) {
      if (title !== g.title) { if (title !== null) y += row + SB_GAP_Y; title = g.title; x = 0; row = 0; }
      nodes.push(sbNode(g, s, 'component', x, y, SB_COMP_W));
      x += SB_COMP_W + SB_GAP_X / 2;
      row = Math.max(row, sbH(`sb:${s.id}`, 'component') + 30);
    }
  }
  return { id: SB, title: 'Storybook', storybook: true, nodes, edges: [], entry: null, issues: [], knowledge: null };
}
let sbRelayoutTimer = 0;
function sbRelayoutSoon() {
  clearTimeout(sbRelayoutTimer);
  sbRelayoutTimer = setTimeout(() => {
    if (S.flowId !== SB || S.drag) return;
    S.sb.flow = sbFlow();
    if (S.mode === 'design') renderCanvas();
  }, 80);
}
function sbMoved(id, pos) {
  S.sb.pos[id] = { x: pos.x, y: pos.y };
  sbSavePrefs();
  S.sb.flow = sbFlow();
  renderCanvas();
}
function sbOpen(storyId) {
  const id = `sb:${storyId}`;
  if (!nodeById(id)) {
    S.sb.pins.add(storyId);
    sbSavePrefs();
    S.sb.flow = sbFlow();
    renderCanvas();
  }
  select({ node: id });
  setTimeout(() => centerOn(id), 60);
}
function sbUnpin(storyId) {
  S.sb.pins.delete(storyId);
  delete S.sb.pos[`sb:${storyId}`];
  sbSavePrefs();
  if (S.sel.node === `sb:${storyId}`) S.sel = { node: null, el: null, edge: null, variant: null };
  S.sb.flow = sbFlow();
  renderAll();
}
// Komponentenbaum aus dem Frame (React) – als Baum wie bei Screen-Modulen.
function sbScreen(n) {
  const fr = n && S.frames.get(n.id);
  const t = fr?.sbTree;
  const tree = !t ? null : t.length === 1 ? t[0] : { id: '', name: leaf(n.group), text: '', props: [], children: t };
  return { tree, stories: [], component: n ? leaf(n.group) : '', lint: { warnings: [], errors: [] }, sb: true };
}
const sbSig = t => JSON.stringify(t, (k, v) => (k === 'text' || k === 'props' ? undefined : v));
function sbTreeArrived(fr, tree) {
  const sig = sbSig(tree);
  fr.sbTree = tree;
  if (sig === fr.sbSig) return;
  fr.sbSig = sig;
  if (S.sel.node === fr.id) {
    if (S.sel.el && !findEl(sbScreen(nodeById(fr.id)).tree, S.sel.el)) S.sel.el = null;
    renderLeft();
    if (S.rightTab !== 'chat') renderRight();
  }
}
const sbSrc = src => (!src ? '' : src.startsWith('/') ? src : `${S.sb.base ? `${S.sb.base.replace(/\/$/, '')}/` : ''}${src}`);
const sbLink = id => (S.sb.url ? `${S.sb.url}/?path=/story/${encodeURIComponent(id)}` : null);
function sbEl(n) {
  if (!S.sel.el) return null;
  const hit = findEl(sbScreen(n).tree, S.sel.el);
  return hit ? hit.node : null;
}
function sbSelection() {
  const n = nodeById(S.sel.node);
  const fr = n && S.frames.get(n.id);
  const el = isSb(n) ? sbEl(n) : null;
  return {
    flow: 'storybook',
    modus: S.mode,
    storybook: S.sb.url,
    knoten: n?.id || null,
    titel: n?.title || null,
    story: isSb(n) ? { id: n.story, gruppe: n.group, name: n.name, export: n.exportName || null, datei: n.file, komponente: n.component, args: fr?.sbInfo?.args || null, link: sbLink(n.story) } : null,
    element: el ? { id: el.id, komponente: el.name, text: el.text || null, quelle: sbSrc(el.src) || null, props: Object.fromEntries((el.props || []).map(p => [p.name, p.raw])) } : null,
  };
}
function sbMeta(n) {
  const el = sbEl(n);
  const out = { flow: 'storybook', titel: n.title, story: n.story, datei: n.file || '', element: el?.id || '', komponente: el?.name || '', quelle: sbSrc(el?.src) };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v));
}
function updateStory(n) {
  const fr = S.frames.get(n.id);
  fr.sb = n.story;
  fr.kind = n.kind;
  fr.w = n.w;
  fr.ref = '';
  if (n.kind === 'component' && !fr.sized) { fr.sized = true; fr.h = 160; }
  fill(fr.title,
    h('b', {}, leaf(n.group)),
    h('span', { class: 'tag', title: `Story ${n.story}` }, n.name),
    fr.failed ? h('span', { class: 'tag bad', title: fr.sbError || 'Fehler in der Story' }, 'Fehler') : null,
    h('button', {
      type: 'button',
      class: 'fmenu',
      title: 'Aktionen: Varianten, Zustände, Review (Rechtsklick oder Taste .)',
      'aria-label': `Aktionen für ${n.title}`,
      onpointerdown: ev => ev.stopPropagation(),
      onclick: ev => {
        const r = ev.currentTarget.getBoundingClientRect();
        select({ node: n.id });
        openMenu(r.left + r.width / 2, r.bottom + 120);
      },
    }, '✦'),
  );
  fr.el.classList.add('story');
  fr.el.classList.toggle('comp', n.kind === 'component');
  fr.box.style.width = `${n.w}px`;
  fr.box.style.height = `${fr.h}px`;
  ensureIframe(fr);
}
function updateNode(n) {
  if (isSb(n)) updateStory(n);
  else updateScreen(n);
}
function sbSetArgs(fr, args) {
  if (fr.sbInfo) fr.sbInfo.args = { ...fr.sbInfo.args, ...args };
  fr.iframe?.contentWindow?.postMessage({ wf: 1, type: 'sbArgs', args }, location.origin);
}

// Linke Spalte: Komponentenbaum der Story und die Stories wie in der Storybook-Seitenleiste.
function sbLayers(pane) {
  const n = nodeById(S.sel.node);
  if (isSb(n)) {
    const scr = sbScreen(n);
    pane.append(h('div', { class: 'grp' }, leaf(n.group), h('em', {}, n.name)));
    if (!scr.tree) pane.append(h('p', { class: 'hint' }, 'Komponentenbaum wird gelesen …'));
    else {
      const items = [];
      walkTree(scr.tree, (el, depth) => {
        if (!el.id) return;
        const sp = spec(el.name);
        items.push(h('li', {}, h('button', {
          type: 'button',
          'aria-current': String(S.sel.el === el.id),
          style: `padding-left:${6 + depth * 14}px`,
          title: sbSrc(el.src) || '',
          onclick: () => select({ node: n.id, el: el.id }),
          onmouseenter: () => { S.hover = { node: n.id, el: el.id }; renderOverlays(); },
          onmouseleave: () => { S.hover = null; renderOverlays(); },
        }, h('span', { class: 'ico' }, el.children.length ? '▤' : '◇'), h('span', { class: 'nm' }, el.name), el.text ? h('span', { class: 'tx' }, el.text) : null, sp ? h('em', { title: `Komponente aus ${S.data.ds.name || 'dem Design System'}` }, 'DS') : null)));
      });
      pane.append(h('ul', { class: 'tree' }, ...items));
      pane.append(h('p', { class: 'hint' }, 'Live aus React, so wie Storybook die Story rendert. Ändern: Args rechts oder Claude (Rechtsklick).'));
    }
  }
  const screens = S.sb.groups.filter(g => g.screen);
  const comps = S.sb.groups.filter(g => !g.screen);
  const item = (s, onBoard, pinned) => h('li', { class: 'sbi' },
    h('button', {
      type: 'button',
      'aria-current': String(S.sel.node === `sb:${s.id}` && !S.sel.el),
      title: onBoard ? s.id : 'Auf den Canvas holen',
      onclick: () => sbOpen(s.id),
    }, h('span', { class: 'ico' }, onBoard ? '▢' : '+'), h('span', { class: 'nm' }, s.name), s.tags.length ? h('em', {}, s.tags.join(' · ')) : null),
    pinned ? h('button', { type: 'button', class: 'unpin', title: 'Vom Canvas nehmen', 'aria-label': `${s.name} vom Canvas nehmen`, onclick: () => sbUnpin(s.id) }, '×') : null);
  const block = (label, groups, note) => {
    if (!groups.length) return;
    pane.append(h('div', { class: 'grp' }, label, h('em', {}, note)));
    pane.append(h('ul', { class: 'tree sbtree' }, ...groups.flatMap(g => [
      h('li', { class: 'sbg', title: g.file || '' }, g.title),
      ...g.stories.map(s => item(s, !!nodeById(`sb:${s.id}`), !g.screen && S.sb.pins.has(s.id))),
    ])));
  };
  if (S.sb.status !== 'verbunden') { pane.append(h('p', { class: 'hint' }, S.sb.hint || 'Suche Storybook …')); return; }
  block('Screens', screens, `${screens.reduce((k, g) => k + g.stories.length, 0)} Stories`);
  block('Komponenten', comps, screens.length ? '+ holt sie her' : `${comps.reduce((k, g) => k + g.stories.length, 0)} Stories`);
}

// Rechte Spalte: Story (Args live), Element (Props | Style), Übersicht.
function sbBoardInspector(pane) {
  pane.append(h('div', { class: 'ihead' }, h('h2', {}, 'Storybook'), h('code', {}, S.sb.url || 'nicht verbunden')));
  if (S.sb.status !== 'verbunden') {
    pane.append(h('p', { class: 'hint' }, S.sb.hint || 'Suche Storybook …'));
    pane.append(h('div', { class: 'btns' }, btn('Erneut suchen', () => loadSb(true))));
    return;
  }
  const screens = S.sb.groups.filter(g => g.screen);
  const states = screens.reduce((k, g) => k + g.stories.length, 0);
  const pinned = flow().nodes.filter(x => x.kind === 'component').length;
  pane.append(h('div', { class: 'grp' }, 'Auf dem Canvas'), h('p', { class: 'hint' }, `${screens.length} Screens mit ${states} Zuständen${pinned ? ` · ${pinned} Komponenten-Stories` : ''}. Gerendert von Storybook selbst – mit euren Decorators, Providern und Styles. Nichts wird migriert.`));
  pane.append(h('div', { class: 'grp' }, 'So arbeitest du hier'), h('ul', { class: 'hint steps' },
    h('li', {}, 'Story anklicken: Args live ändern wie in den Controls und von Claude in den Code übernehmen lassen.'),
    h('li', {}, 'Element anklicken: Komponente, Props, Style-Tokens und Kontrast.'),
    h('li', {}, 'Rechtsklick: Varianten, Zustände und Reviews durch Claude – als neue Stories.')));
  pane.append(h('div', { class: 'grp' }, 'Screens erkennen'), h('p', { class: 'hint' }, 'Als Screens gelten Titel wie „Screens/…“ oder „Pages/…“ und Stories aus Ordnern wie screens/ oder pages/. Anpassen in .wireflow/project.json: ', h('code', {}, '"storybook": { "screens": ["Bereich/"] }'), '.'));
  pane.append(h('div', { class: 'btns' }, h('a', { class: 'btn', href: S.sb.url, target: '_blank', rel: 'noopener' }, 'Storybook öffnen ↗'), btn('Neu laden', () => loadSb(true))));
}
function sbStoryInspector(pane, n) {
  const fr = S.frames.get(n.id);
  const info = fr?.sbInfo;
  pane.append(h('div', { class: 'ihead' },
    h('h2', {}, leaf(n.group), h('span', { class: 'hsub' }, ` · ${n.name}`)),
    h('code', {}, n.file || n.story),
    h('span', { class: 'tag' }, 'Storybook')));
  if (n.component) pane.append(h('p', { class: 'hint' }, 'Komponente: ', h('code', {}, n.component)));
  if (fr?.failed) pane.append(h('p', { class: 'sberr' }, fr.sbError || 'Die Story wirft einen Fehler – Details im Storybook.'));
  pane.append(h('div', { class: 'grp' }, 'Args', h('em', {}, 'live, wie die Controls')));
  if (!info) { pane.append(h('p', { class: 'hint' }, 'Story wird geladen …')); return; }
  const names = Object.keys(info.argTypes).filter(k => !info.argTypes[k].action);
  for (const k of Object.keys(info.args || {})) if (!names.includes(k) && !info.argTypes[k]?.action) names.push(k);
  if (!names.length) pane.append(h('p', { class: 'hint' }, 'Diese Story hat keine Args.'));
  for (const k of names) pane.append(sbArgRow(fr, k, info.argTypes[k] || {}, info.args?.[k], info.initialArgs?.[k]));
  const changed = names.filter(k => JSON.stringify(info.args?.[k]) !== JSON.stringify(info.initialArgs?.[k]));
  if (changed.length) {
    const diff = Object.fromEntries(changed.map(k => [k, info.args?.[k]]));
    pane.append(h('p', { class: 'hint' }, `${changed.length} ${changed.length === 1 ? 'Arg' : 'Args'} geändert – nur im Canvas, die Story-Datei ist unverändert.`));
    pane.append(h('div', { class: 'btns' },
      btn('In Code übernehmen', () => askClaude(`Übernimm diese Args in die Storybook-Story „${n.title}“ (Datei ${n.file}, Export ${n.exportName || n.name}, ID ${n.story}): ${JSON.stringify(diff)}. Ändere nur die args dieser Story, sonst nichts, und sag kurz per canvas_reply Bescheid.`, 'auftrag'), false, 'pri'),
      btn('Zurücksetzen', () => fr.iframe?.contentWindow?.postMessage({ wf: 1, type: 'sbReset' }, location.origin))));
  }
  pane.append(h('div', { class: 'btns' }, sbLink(n.story) ? h('a', { class: 'btn', href: sbLink(n.story), target: '_blank', rel: 'noopener' }, 'In Storybook öffnen ↗') : null));
}
function sbArgRow(fr, name, at, value, initial) {
  const key = `sbarg:${name}`;
  const set = v => sbSetArgs(fr, { [name]: v });
  const changed = JSON.stringify(value) !== JSON.stringify(initial);
  const label = h('label', { for: key, title: at.description || at.type || '' }, name, at.required ? h('span', { class: 'req' }, ' *') : null, changed ? h('span', { class: 'chg', title: 'Geändert gegenüber der Story' }, ' ●') : null);
  let ctl;
  const opts = at.options;
  if (value && typeof value === 'object' && value.$wf === 'element') ctl = h('span', { class: 'code', title: 'React-Element – im Code ändern' }, `‹${value.name}›`);
  else if (opts && opts.length <= 5 && opts.join('').length <= 34) {
    ctl = h('div', { class: 'segctl', role: 'group', id: key, 'aria-label': name }, ...opts.map(o => h('button', {
      type: 'button', 'aria-pressed': String(value !== undefined && String(value) === o), onclick: () => set(o),
    }, o)));
  } else if (opts) {
    ctl = h('select', { id: key, 'data-key': key, onchange: ev => set(ev.target.value) }, ...opts.map(o => h('option', { value: o, selected: String(value) === o }, o)));
  } else if (at.type === 'boolean' || at.control === 'boolean' || typeof value === 'boolean') {
    const on = value === true;
    ctl = h('button', { type: 'button', role: 'switch', class: 'switch', id: key, 'aria-checked': String(on), 'aria-label': name, onclick: () => set(!on) }, h('i'));
  } else if (at.type === 'number' || at.control === 'number' || at.control === 'range' || typeof value === 'number') {
    ctl = h('input', { type: 'number', id: key, 'data-key': key });
    ctl.value = value === undefined ? '' : String(value);
    ctl.addEventListener('change', () => set(ctl.value === '' ? undefined : Number(ctl.value)));
    ctl.addEventListener('keydown', e => { if (e.key === 'Enter') ctl.blur(); });
  } else if (value === undefined || typeof value === 'string') {
    ctl = h('input', { type: 'text', id: key, 'data-key': key, placeholder: 'Nicht gesetzt' });
    ctl.value = value ?? '';
    ctl.addEventListener('change', () => set(ctl.value));
    ctl.addEventListener('keydown', e => { if (e.key === 'Enter') ctl.blur(); });
  } else {
    ctl = h('textarea', { id: key, 'data-key': key, rows: '3', title: 'JSON' });
    ctl.value = JSON.stringify(value);
    ctl.addEventListener('change', () => { try { set(JSON.parse(ctl.value)); } catch { toast('Kein gültiges JSON', 'bad'); } });
  }
  if (ctl.classList?.contains('segctl')) return h('div', { class: 'row stack' }, h('div', { class: 'rlabel' }, label), ctl);
  return h('div', { class: 'row' }, label, h('div', { class: 'ctl' }, ctl));
}
function sbElementInspector(pane, n) {
  const el = sbEl(n);
  if (!el) { sbStoryInspector(pane, n); return; }
  const sp = spec(el.name);
  const path = [];
  for (let id = el.id; id; id = id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '') path.unshift(id.slice(id.lastIndexOf('/') + 1).replace(/\.\d+$/, ''));
  pane.append(h('div', { class: 'ihead' },
    h('h2', {}, el.name, el.text ? h('span', { class: 'hsub' }, ` · ${el.text.length > 26 ? `${el.text.slice(0, 25)}…` : el.text}`) : null),
    h('code', { title: el.id }, path.join(' › ')),
    sp ? h('span', { class: 'tag ok' }, S.data.ds.name || 'DS') : h('span', { class: 'tag' }, 'Komponente')));
  if (sp?.description) pane.append(h('p', { class: 'hint' }, sp.description));
  pane.append(h('div', { class: 'seg elseg', role: 'tablist', 'aria-label': 'Props oder Style' }, ...[['props', 'Props'], ['style', 'Style']].map(([id, label]) => h('button', {
    type: 'button', role: 'tab', 'aria-selected': String(S.elTab === id), 'aria-pressed': String(S.elTab === id),
    onclick: () => { S.elTab = id; renderRight(); },
  }, label))));
  const fr = S.frames.get(n.id);
  if (S.elTab === 'style') {
    const b = fr?.boxes?.[el.id];
    pane.append(h('div', { class: 'grp' }, 'Größe', h('em', {}, b ? `${b[2]} × ${b[3]} px` : '–')));
    const look = computedLook(fr, el.id);
    pane.append(h('div', { class: 'grp' }, 'Aussehen', h('em', {}, `Tokens aus ${S.data.ds.name || 'dem Design System'}`)));
    if (!look) pane.append(h('p', { class: 'hint' }, 'Wird gelesen …'));
    else {
      pane.append(h('div', { class: 'looks' }, ...look.rows.map(lookRow)));
      if (look.contrast) {
        const ok = look.contrast.ratio >= look.contrast.need;
        pane.append(h('div', { class: `contrast ${ok ? 'ok' : 'bad'}` },
          h('b', {}, `Kontrast ${look.contrast.ratio.toFixed(2).replace('.', ',')} : 1`),
          h('span', {}, ok ? `erfüllt WCAG AA (${look.contrast.need.toString().replace('.', ',')} : 1${look.contrast.large ? ', großer Text' : ''})` : `zu gering – braucht ${look.contrast.need.toString().replace('.', ',')} : 1`)));
      }
      if (look.untokened) pane.append(h('p', { class: 'hint' }, `${look.untokened} Wert${look.untokened === 1 ? '' : 'e'} ohne Token.`));
    }
  } else {
    pane.append(h('div', { class: 'grp' }, 'Props', h('em', {}, 'wie gerendert')));
    if (!el.props?.length) pane.append(h('p', { class: 'hint' }, 'Keine Props.'));
    for (const p of el.props || []) pane.append(h('div', { class: 'row' }, h('label', { title: p.name }, p.name), h('div', { class: 'ctl' }, h('span', { class: 'code', title: p.raw }, p.raw))));
    if (el.src) pane.append(h('p', { class: 'hint' }, 'Im Code: ', h('code', {}, sbSrc(el.src))));
  }
  const inp = h('textarea', { class: 'ask', rows: '2', 'data-key': 'sb:ask', placeholder: `Was soll sich an ${el.name} ändern?` });
  const go = () => {
    const t = inp.value.trim();
    if (!t) return;
    askClaude(`${t}\n\nGemeint ist <${el.name}> (${el.id}) in der Storybook-Story „${n.title}“ (Datei ${n.file}${el.src ? `, Element entsteht in ${sbSrc(el.src)}` : ''}). Ändere den Code des Projekts, nutze Komponenten und Tokens des Design Systems und antworte kurz per canvas_reply.`, 'auftrag');
  };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); go(); } });
  pane.append(h('div', { class: 'grp' }, 'Ändern', h('em', {}, 'durch Claude')), inp, h('div', { class: 'btns' }, btn('An Claude', go, false, 'pri')));
}
function sbCodePane(pane, n) {
  const el = sbEl(n);
  const files = [];
  if (el?.src && !el.src.startsWith('/')) files.push(['Element', sbSrc(el.src)]);
  if (n.file) files.push(['Story', n.file]);
  if (n.component) files.push(['Komponente', n.component]);
  const seen = new Set();
  const list = files.filter(([, f]) => (seen.has(f) ? false : seen.add(f)));
  if (!list.length) { pane.append(h('p', { class: 'hint' }, 'Für diese Story ist keine Datei bekannt.')); return; }
  const cur = list.find(([, f]) => f === S.sb.file)?.[1] || list[0][1];
  const key = `file:${cur}@${Math.floor(Date.now() / 4000)}`;
  const d = S.codeCache.get(key);
  if (!d) {
    pane.append(h('p', { class: 'hint' }, 'Lade Code …'));
    api(`/api/file?path=${encodeURIComponent(cur)}`).then(x => { S.codeCache.set(key, x); if (S.rightTab === 'code') renderRight(); }).catch(e => toast(e.message, 'bad'));
    return;
  }
  const mark = el && cur === sbSrc(el.src) ? new RegExp(`<${el.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`) : null;
  const pre = h('pre', { class: 'codeview', tabindex: '0', 'aria-label': `Quelltext ${cur}` });
  d.source.split('\n').forEach((line, i) => {
    const row = document.createElement('div');
    row.className = `cl${mark && mark.test(line) ? ' on' : ''}`;
    row.innerHTML = `<span class="ln">${i + 1}</span>${syntax(esc(line)) || ' '}`;
    pre.append(row);
  });
  pane.append(
    h('div', { class: 'ihead' }, h('code', {}, cur)),
    list.length > 1 ? h('div', { class: 'seg sub', role: 'group', 'aria-label': 'Datei' }, ...list.map(([l, f]) => h('button', { type: 'button', 'aria-pressed': String(f === cur), title: f, onclick: () => { S.sb.file = f; renderRight(); } }, l))) : null,
    pre,
    h('p', { class: 'hint' }, 'Code des Projekts, wie Storybook ihn rendert. Änderungen (auch durch Claude) erscheinen über Storybook sofort im Frame.'),
  );
  requestAnimationFrame(() => pre.querySelector('.cl.on')?.scrollIntoView({ block: 'center' }));
}
function sbMenuItems(n, hit) {
  const where = `Storybook-Story „${n.title}“ (ID ${n.story}, Datei ${n.file}${n.component ? `, Komponente ${n.component}` : ''})`;
  const el = hit && hit.node.id && hit.parent ? hit.node : null;
  const elInfo = el ? ` – mit Fokus auf <${el.name}> (${el.id}${el.src ? `, entsteht in ${sbSrc(el.src)}` : ''})` : '';
  const ask = (text, kind) => () => askClaude(text, kind);
  const toCode = () => { S.rightTab = 'code'; renderRight(); };
  const toChat = () => {
    S.rightTab = 'chat';
    S.chat.attach = true;
    S.chat.unread = 0;
    renderRight();
    setTimeout(() => $('#right [data-key="chat:input"]')?.focus(), 30);
  };
  const variants = mode => `Erzeuge 2 Varianten der ${where}${elInfo} im Modus ${MODE_LABEL[mode]}: ${MODE_HINT[mode]} Lege jede Variante als neue Story im selben Stories-File an (z. B. ${n.exportName || 'Story'}Variante1). Braucht eine Variante einen anderen Aufbau, kopiere die Komponente daneben (z. B. Name.variante-1.tsx) und lass das Original unverändert. Nenne den Unterschied je Variante in einem Satz per canvas_reply.`;
  return [
    { id: 'variants', label: 'Varianten', icon: '▦', angle: -90, sub: ['strict', 'guided', 'free'].map(mode => ({ label: MODE_LABEL[mode], title: MODE_HINT[mode], run: ask(variants(mode), 'varianten') })) },
    { id: 'next', label: 'Weiter', icon: '→', angle: -30, sub: [{ label: '+ Nächster Screen', run: ask(`Entwirf den Screen, der auf die ${where}${elInfo} folgt: neue Komponente mit Story in derselben Gruppe, aus Komponenten des Design Systems und mit realistischen Args. Sag per canvas_reply, welche Datei und Story entstanden sind.`, 'weiter') }] },
    { id: 'states', label: 'Zustände', icon: '◫', angle: 30, sub: ['Leer', 'Fehler', 'Laden', 'Erstnutzung', 'Offline'].map(z => ({ label: z, run: ask(`Lege für die ${where} den Zustand „${z}“ als neue Story im selben Stories-File an – passend zu den Patterns des Design Systems und mit realistischen Args. Ändere die Komponente nur, wenn sich der Zustand sonst nicht zeigen lässt, und sag kurz per canvas_reply, was er zeigt.`, 'zustand') })) },
    { id: 'code', label: 'Code', icon: '</>', angle: 90, run: toCode },
    { id: 'chat', label: 'Chat', icon: '✦', angle: 150, run: toChat },
    { id: 'review', label: 'Review', icon: '◎', angle: 210, sub: reviewItems(`„${n.title}“ (Storybook-Story ${n.story}, Datei ${n.file})${elInfo}`) },
  ];
}

// ---------- Kopf, Status, Modus ----------
// Darstellung des Werkzeugs: wie das System, dunkel oder hell (wie im Click-Dummy)
const THEMES = ['auto', 'dark', 'light'];
const THEME_INFO = { auto: ['◐', 'Darstellung: wie das System'], dark: ['☾', 'Darstellung: dunkel'], light: ['☀', 'Darstellung: hell'] };
let theme = (() => { try { return localStorage.getItem('wireflow-theme') || 'auto'; } catch { return 'auto'; } })();
function applyTheme() {
  if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  const b = $('#themeBtn');
  b.textContent = THEME_INFO[theme][0];
  b.title = `${THEME_INFO[theme][1]} – klicken zum Wechseln`;
  b.setAttribute('aria-label', THEME_INFO[theme][1]);
}
$('#themeBtn').addEventListener('click', () => {
  theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  try { localStorage.setItem('wireflow-theme', theme); } catch { /* privat */ }
  applyTheme();
  toast(THEME_INFO[theme][1]);
});
applyTheme();

// Schmale Fenster: linke und rechte Spalte als Schubladen (Knöpfe nur dort sichtbar).
function setDrawer(side, open) {
  const app = $('#app');
  if (open) app.dataset[side] = 'open';
  else delete app.dataset[side];
  $(side === 'left' ? '#leftBtn' : '#rightBtn').setAttribute('aria-expanded', String(!!open));
}
$('#leftBtn').addEventListener('click', () => { setDrawer('right', false); setDrawer('left', $('#app').dataset.left !== 'open'); });
$('#rightBtn').addEventListener('click', () => { setDrawer('left', false); setDrawer('right', $('#app').dataset.right !== 'open'); });
$('#stage').addEventListener('pointerdown', () => { setDrawer('left', false); setDrawer('right', false); }, true);
addEventListener('keydown', e => { if (e.key === 'Escape') { setDrawer('left', false); setDrawer('right', false); } });

function renderTop() {
  $('#crumb').textContent = S.data.project.name || '';
  const darkBtn = document.querySelector('[data-fid="dark"]');
  darkBtn.hidden = !(S.data.ds.modes || []).includes('dark');
  if (darkBtn.hidden && S.fid === 'dark') S.fid = 'hifi';
  const sel = $('#flowSel');
  const sbCount = S.sb.groups.reduce((k, g) => k + g.stories.length, 0);
  const sbOpt = S.sb.status === 'verbunden' || S.sb.dirs.length || S.flowId === SB
    ? `<option value="${SB}"${S.flowId === SB ? ' selected' : ''}>${S.sb.status === 'verbunden' ? `Storybook · ${sbCount} ${sbCount === 1 ? 'Story' : 'Stories'}` : 'Storybook (läuft nicht)'}</option>`
    : '';
  const opts = S.data.flows.map(f => `<option value="${esc(f.id)}"${f.id === S.flowId ? ' selected' : ''}>${esc(f.title || f.id)}</option>`).join('') + sbOpt;
  if (sel.innerHTML !== opts) sel.innerHTML = opts || '<option>Kein Flow</option>';
  sel.disabled = !opts;
  document.querySelectorAll('[data-fid]').forEach(b => { b.disabled = S.flowId === SB; b.title = S.flowId === SB ? 'Storybook-Stories rendert Storybook selbst – mit euren Decorators und Styles' : b.dataset.fid === 'dark' ? 'Screens im Dunkelmodus des Design Systems' : ''; });
  document.querySelectorAll('[data-fid]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.fid === S.fid)));
}
function renderStatus() {
  const d = S.data;
  const f = flow();
  const hints = { design: 'Rechtsklick oder .: Kontextmenü · Titel ziehen: verschieben · Fläche ziehen: schwenken · ⌘/Strg+Scrollen: zoomen · 0: alles zeigen', prototype: 'Variablen rechts steuern die Entscheidungen', journey: 'Plus zwischen Schritten: einfügen · Doppelklick: umbenennen · ⌥+Pfeile: verschieben · ⌘Z: rückgängig', knowledge: 'Annahmen nach Risiko sortiert' };
  if (f?.storybook) {
    const stories = S.sb.groups.reduce((k, g) => k + g.stories.length, 0);
    fill($('#status'),
      h('span', {}, S.sb.status === 'verbunden' ? `Storybook ${S.sb.url.replace(/^https?:\/\//, '')}` : 'Storybook läuft nicht'),
      h('span', {}, `${stories} Stories · ${S.sb.groups.filter(g => g.screen).length} Screens · ${f.nodes.length} auf dem Canvas`),
      h('span', { class: 'sp' }, 'Klick: Story oder Komponente wählen · Args rechts ändern die Story live · Rechtsklick oder .: Kontextmenü'));
    return;
  }
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
  if (m === 'prototype' && S.flowId === SB) {
    S.flowId = S.data.flows[0]?.id || null;
    S.sel = { node: null, el: null, edge: null, variant: null };
    toast('Der Prototyp läuft über Flows – Storybook-Stories haben noch keine Verbindungen.', 'warn');
  }
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
  if (S.menu && e.key === 'Escape') { e.preventDefault(); closeMenu(); return; }
  if (S.picker && e.key === 'Escape') { e.preventDefault(); closePicker(); return; }
  const typing = e.target.closest?.('input,textarea,select,[contenteditable]');
  const mod = e.metaKey || e.ctrlKey;
  if (typing) { if (e.key === 'Escape') e.target.blur(); return; }
  if (S.mode === 'journey') {
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? jRedo() : jUndo(); return; }
    if (e.key === 'Escape' && J.sel) { J.sel = null; jRender(); return; }
  }
  if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
  if (S.mode === 'design') {
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel.el) { e.preventDefault(); removeSelected(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel.edge != null) { e.preventDefault(); flowOp({ op: 'disconnect', index: S.sel.edge }); select({}); return; }
    if (mod && e.key.toLowerCase() === 'd' && S.sel.el) { e.preventDefault(); duplicateSelected(); return; }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && S.sel.el) { e.preventDefault(); moveSelected(e.key === 'ArrowUp' ? -1 : 1); return; }
    if (e.key === 'Escape') { selectParent(); return; }
    if (e.key === '.' && S.sel.node && !mod) {
      const c = selectionCenter();
      if (c) { e.preventDefault(); openMenu(c.x, c.y); }
      return;
    }
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
  await loadSb();
  if ((!S.data.flows.length || new URLSearchParams(location.search).get('board') === 'storybook') && (S.sb.status === 'verbunden' || S.sb.dirs.length)) S.flowId = SB;
  try {
    const c = await api('/api/chat');
    Object.assign(S.chat, { connected: !!c.connected, channel: !!c.channel, messages: c.messages || [] });
  } catch {
    /* ohne Chat */
  }
  applyView();
  connect();
  setMode('design');
}
init();
