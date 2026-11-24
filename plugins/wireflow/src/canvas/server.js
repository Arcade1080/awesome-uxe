// Canvas-Server: lokale Web-App, rendert Screen-Module mit den echten Komponenten
// des Design Systems (gebündelt mit dem esbuild des Projekts) und schreibt Änderungen
// vom Canvas als Code zurück. Nur 127.0.0.1, Zugang über ein Token im Link.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadProject, WF, readJson, undoLast } from '../core/project.js';
import { loadTokens, tokensCss, components } from '../core/ds.js';
import { lintScreen } from '../core/lint.js';
import { flowIssues } from '../core/flow.js';
import { flowKnowledge, openAssumptions } from '../core/knowledge.js';
import { applyOpRecorded, handlerProp, changeLog, revertChange } from '../core/screens.js';
import { applyFlowOp } from '../core/flows.js';
import { getAttr, textOf, walk } from '../core/jsx.js';
import { packageDir } from '../core/init.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, 'app');
const RUNTIME = path.join(HERE, '..', 'runtime', 'index.js');
const STATE_FILE = '.canvas-state.json';
const instances = new Map();

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const forScript = v => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

// ---------- Projekt als JSON für die Canvas-App ----------
function outline(n) {
  return {
    id: getAttr(n, 'data-wf') || null,
    name: n.name,
    text: textOf(n) || '',
    code: n.children.some(c => c.type === 'expr'),
    props: n.attrs.filter(a => a.name && a.name !== 'data-wf').map(a => ({ name: a.name, kind: a.kind, raw: a.raw ?? null })),
    children: n.children.filter(c => c.type === 'el').map(outline),
  };
}

export function projectJson(root, v = 0) {
  const m = loadProject(root);
  const screens = {};
  for (const [ref, s] of Object.entries(m.screens)) {
    screens[ref] = { ref, component: s.component || null, stories: s.stories, error: s.error || null, tree: s.tree ? outline(s.tree) : null, lint: lintScreen(s, m) };
  }
  const comps = components(m.manifest);
  return {
    v,
    project: m.project,
    ds: {
      name: m.manifest.name || '',
      package: m.manifest.package || '',
      version: m.manifest.version || '',
      components: (m.manifest.components || []).map(c => ({ ...c, handler: handlerProp(c) })),
      gaps: m.manifest.gaps || [],
      patterns: m.patterns.map(p => ({ id: p.id, name: p.meta.name || p.id, status: p.meta.status || '', text: p.text })),
      tokens: loadTokens(m).map(t => ({ path: t.path, type: t.type, css: t.css })),
      modes: Object.keys(m.manifest.tokens?.modes || {}),
      known: [...comps.keys()],
    },
    flows: m.flows.map(f => ({ ...f, issues: flowIssues(f, m), knowledge: flowKnowledge(f, m.knowledge) })),
    journeys: m.journeys,
    knowledge: { ...m.knowledge, risk: openAssumptions(m.knowledge).map(a => a.id) },
    screens,
  };
}

// ---------- Bündeln mit dem esbuild des Projekts ----------
function loadEsbuild(root) {
  try {
    return createRequire(path.join(root, 'package.json'))('esbuild');
  } catch {
    return null;
  }
}

function formatErrors(errors, root) {
  return errors.slice(0, 5).map(e => {
    const loc = e.location ? `${path.relative(root, path.resolve(root, e.location.file))}:${e.location.line}:${e.location.column}\n  ${e.location.lineText}\n` : '';
    return `${loc}${e.text}`;
  }).join('\n\n');
}

const MOUNT = `
const W = window.__WF__ || {};
function fail(msg) { if (window.__wfError) window.__wfError(msg); else document.body.textContent = msg; }
const entry = R[W.ref];
if (!entry) fail('Screen ' + W.ref + ' ist nicht im Bundle.');
else {
  const [mod, stories, name, variant] = entry;
  const meta = (stories && stories.default) || {};
  const Comp = (variant && (mod[name] || mod.default)) || meta.component || mod[name] || mod.default;
  const names = stories ? Object.keys(stories).filter(k => k !== 'default' && /^[A-Z]/.test(k)) : [];
  const story = (stories && (stories[W.story] || stories[names[0]])) || {};
  const args = Object.assign({}, meta.args, story.args);
  let Render = () => story.render && !variant ? story.render(args, { args }) : h((!variant && story.component) || Comp, args);
  for (const d of [].concat(story.decorators || [], meta.decorators || [])) { const Inner = Render; Render = () => d(Inner, { args }); }
  try {
    createRoot(document.getElementById('root'), { onUncaughtError: e => fail(String((e && e.stack) || e)) }).render(h(Render));
  } catch (e) { fail(String((e && e.stack) || e)); }
}`;

async function buildBundle(root) {
  const m = loadProject(root);
  const esbuild = loadEsbuild(root);
  if (!esbuild) return { error: 'esbuild ist im Projekt nicht installiert.\nDer Canvas rendert Screens mit dem Bundler des Projekts: npm i -D esbuild' };
  const failed = {};
  for (const s of Object.values(m.screens)) if (s.error) failed[s.ref] = s.error;
  const rel = f => './' + path.relative(m.wf, f).split(path.sep).join('/');
  // Varianten haben keine eigenen Stories: Sie bekommen die Daten (Args) des Originals.
  const parentOf = {};
  for (const f of m.flows) for (const n of f.nodes || []) for (const v of n.variants || []) parentOf[v.ref] = n.ref;
  for (let attempt = 0; attempt < 4; attempt++) {
    const list = Object.values(m.screens).filter(s => !failed[s.ref]);
    const lines = ["import { createElement as h } from 'react';", "import { createRoot } from 'react-dom/client';"];
    for (const st of [].concat(m.manifest.styles || [], m.project.renderer?.styles || [])) {
      lines.push(`import ${JSON.stringify(st.startsWith('.') ? path.resolve(root, st) : st)};`);
    }
    const reg = [];
    list.forEach((s, i) => {
      const variant = !s.storiesFile && parentOf[s.ref] ? m.screens[parentOf[s.ref]] : null;
      const storiesFile = s.storiesFile || variant?.storiesFile || null;
      lines.push(`import * as m${i} from ${JSON.stringify(rel(s.file))};`);
      if (storiesFile) lines.push(`import * as s${i} from ${JSON.stringify(rel(storiesFile))};`);
      reg.push(`${JSON.stringify(s.ref)}: [m${i}, ${storiesFile ? `s${i}` : 'null'}, ${JSON.stringify(s.component || '')}, ${variant ? 'true' : 'false'}]`);
    });
    lines.push(`const R = {\n${reg.join(',\n')}\n};`, MOUNT);
    try {
      const out = await esbuild.build({
        stdin: { contents: lines.join('\n'), resolveDir: m.wf, sourcefile: 'wireflow-canvas.jsx', loader: 'jsx' },
        absWorkingDir: root,
        bundle: true,
        write: false,
        outdir: path.join(m.wf, '.canvas-out'),
        entryNames: 'bundle',
        format: 'iife',
        platform: 'browser',
        target: 'es2020',
        jsx: 'automatic',
        logLevel: 'silent',
        nodePaths: [path.join(root, 'node_modules')],
        define: { 'process.env.NODE_ENV': '"development"' },
        loader: Object.fromEntries(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.woff', '.woff2', '.ttf', '.otf'].map(e => [e, 'dataurl'])),
        plugins: [{ name: 'wireflow-runtime', setup(b) { b.onResolve({ filter: /^@wireflow\/runtime$/ }, () => ({ path: RUNTIME })); } }],
      });
      const js = out.outputFiles.find(f => f.path.endsWith('.js'))?.text || '';
      const css = out.outputFiles.find(f => f.path.endsWith('.css'))?.text || '';
      return { js, css, failed };
    } catch (e) {
      const errs = e.errors || [{ text: e.message }];
      const culprits = new Set();
      for (const er of errs) {
        const file = er.location?.file ? path.resolve(root, er.location.file) : '';
        const hit = list.find(s => file === s.file || file === s.storiesFile);
        if (hit) { culprits.add(hit.ref); failed[hit.ref] = formatErrors([er], root); }
      }
      if (!culprits.size) return { error: formatErrors(errs, root), failed };
    }
  }
  return { error: 'Zu viele fehlerhafte Screens.', failed };
}

// ---------- HTTP ----------
function send(res, status, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 2_000_000) { reject(new Error('Anfrage zu groß')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('Ungültiges JSON')); }
    });
    req.on('error', reject);
  });
}

const cookies = h => Object.fromEntries((h || '').split(';').map(x => x.trim().split('=')).filter(x => x[0]).map(([k, ...v]) => [k, v.join('=')]));

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onErr = e => {
      server.off('listening', onOk);
      if (e.code === 'EADDRINUSE' && port !== 0) listen(server, 0).then(resolve, reject);
      else reject(e);
    };
    const onOk = () => { server.off('error', onErr); resolve(server.address().port); };
    server.once('error', onErr);
    server.once('listening', onOk);
    server.listen(port, '127.0.0.1');
  });
}

export async function startCanvas({ root, port, bridge = null } = {}) {
  if (!root) throw new Error('Kein Wireflow-Projekt gefunden. Mit /wireflow:init anlegen.');
  root = path.resolve(root);
  if (instances.has(root)) return instances.get(root);
  const wf = path.join(root, WF);
  const token = crypto.randomBytes(18).toString('base64url');
  // v: jede Änderung (für die App); code: nur Änderungen, die das Bundle betreffen.
  const st = { v: 1, code: 1, bundle: null, building: null, clients: new Set(), own: new Map(), pending: new Set(), timer: null };
  const dataOnly = f => /^\.wireflow\/(flows|journeys|knowledge|decisions|research|ds\/patterns)\//.test(f) || /\.(md|gitkeep)$/.test(f);
  let actualPort = 0;

  const getBundle = () => {
    if (st.bundle && st.bundle.v === st.code) return Promise.resolve(st.bundle);
    if (st.building && st.building.v === st.code) return st.building.p;
    const v = st.code;
    const p = buildBundle(root).then(b => (st.bundle = { ...b, v })).catch(e => (st.bundle = { error: e.message, failed: {}, v }));
    st.building = { v, p };
    return p;
  };

  const broadcast = (event, data) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of st.clients) c.write(msg);
  };
  const changed = (files, by = null) => {
    st.v++;
    if (files.some(f => !dataOnly(f))) st.code++;
    broadcast('change', { v: st.v, files, by });
  };
  const queue = rel => {
    st.pending.add(rel);
    clearTimeout(st.timer);
    st.timer = setTimeout(() => {
      const files = [...st.pending];
      st.pending.clear();
      changed(files);
    }, 120);
  };
  // Eigene Schreibvorgänge sofort melden, Watcher-Echo ignorieren.
  const ownWrite = (files, by) => {
    const now = Date.now();
    for (const f of files) st.own.set(f, now);
    clearTimeout(st.timer);
    const ext = [...st.pending];
    st.pending.clear();
    if (ext.length) changed(ext);
    changed(files, by);
    return files;
  };

  const watchers = [];
  const watch = (dir, prefix) => {
    try {
      watchers.push(fs.watch(dir, { recursive: true }, (_ev, name) => {
        if (!name) return;
        const rel = (prefix + name).split(path.sep).join('/');
        if (rel.endsWith(STATE_FILE) || rel.includes('.canvas-out') || /(^|\/)\.git(\/|$)|~$|\.swp$/.test(rel)) return;
        const t = st.own.get(rel);
        if (t && Date.now() - t < 1500) return;
        queue(rel);
      }));
    } catch {
      /* Verzeichnis fehlt oder Plattform ohne rekursives watch */
    }
  };
  watch(wf, `${WF}/`);
  try {
    const m = loadProject(root);
    const dsDir = m.manifest.package && packageDir(root, m.manifest.package);
    if (dsDir && !dsDir.includes(`${path.sep}node_modules${path.sep}`)) watch(dsDir, `${path.relative(root, dsDir)}/`);
    for (const a of m.project.screens?.allowedImports || []) {
      const dir = path.resolve(wf, 'screens', a);
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) watch(dir, `${path.relative(root, dir)}/`);
    }
  } catch {
    /* Projekt (noch) nicht lesbar */
  }

  const staticFile = (res, name) => {
    const file = path.join(APP, name);
    if (!file.startsWith(APP) || !fs.existsSync(file)) return send(res, 404, 'Nicht gefunden', 'text/plain; charset=utf-8');
    send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
  };

  const modelNow = () => (st.model?.v === st.v ? st.model.m : (st.model = { v: st.v, m: loadProject(root) }).m);
  const renderPage = async q => {
    const m = modelNow();
    const ref = q.get('ref') || '';
    const wanted = q.get('mode') || 'hifi';
    const mode = Object.keys(m.manifest.tokens?.modes || {}).includes(wanted) ? wanted : 'hifi';
    let vars = {};
    try { vars = JSON.parse(q.get('vars') || '{}'); } catch { /* leer */ }
    const wfInfo = { ref, story: q.get('story') || '', mode, ui: q.get('ui') === 'prototype' ? 'prototype' : 'design', vars };
    const b = await getBundle();
    const err = b.error || b.failed?.[ref] || (m.screens[ref] ? null : `Screen-Modul ${ref} fehlt.`);
    return `<!doctype html>
<html lang="de" data-wf-mode="${mode}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${ref.replace(/[<>&"]/g, '')}</title>
<style>${tokensCss(m).replace(/<\//g, '<\\/')}</style>
${b.css && !err ? `<link rel="stylesheet" href="/bundle.css?v=${b.v}">` : ''}
<style>html,body{height:100%;margin:0}#root{height:100%}.wf-error{margin:0;padding:16px;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;color:#9f1d14;background:#fff4f2;min-height:100%;box-sizing:border-box}</style>
</head>
<body>
<div id="root"></div>
<script>window.__WF__=${forScript(wfInfo)}</script>
<script src="/frame.js"></script>
${err ? `<script>window.__wfError(${forScript(err)})</script>` : `<script src="/bundle.js?v=${b.v}"></script>`}
</body>
</html>`;
  };

  const writeSelection = sel => {
    const file = path.join(wf, STATE_FILE);
    st.own.set(`${WF}/${STATE_FILE}`, Date.now());
    fs.writeFileSync(file, JSON.stringify({ auswahl: sel, zeit: new Date().toISOString() }, null, 2) + '\n');
  };

  const routes = async (req, res, u) => {
    const p = u.pathname;
    if (req.method === 'GET') {
      if (p === '/' || p === '/index.html') return staticFile(res, 'index.html');
      if (p === '/app.js' || p === '/app.css' || p === '/frame.js') return staticFile(res, p.slice(1));
      if (p === '/api/project') {
        const changes = changeLog().slice(-40).map(({ inverse, ...c }) => ({ ...c, revertible: !!inverse && !c.reverted }));
        return send(res, 200, { ...projectJson(root, st.v), changes });
      }
      if (p === '/api/chat') return send(res, 200, { connected: !!bridge, channel: !!bridge?.channel, messages: bridge?.log || [] });
      if (p === '/api/source') {
        const ref = u.searchParams.get('ref') || '';
        const s = modelNow().screens[ref];
        if (!s || s.source == null) return send(res, 404, { error: `Screen ${ref} nicht gefunden` });
        const lineOf = i => s.source.slice(0, i).split('\n').length;
        const lines = {};
        if (s.tree) walk(s.tree, n => { const id = getAttr(n, 'data-wf'); if (id && n.start != null) lines[id] = [lineOf(n.start), lineOf(n.end)]; });
        const stories = s.storiesFile ? fs.readFileSync(s.storiesFile, 'utf8') : null;
        return send(res, 200, { ref, file: `${WF}/${ref}`, source: s.source, stories, storiesFile: s.storiesFile ? path.relative(root, s.storiesFile).split(path.sep).join('/') : null, lines });
      }
      if (p === '/render') return send(res, 200, await renderPage(u.searchParams), TYPES['.html']);
      if (p === '/bundle.js' || p === '/bundle.css') {
        const b = await getBundle();
        if (p === '/bundle.css') return send(res, 200, b.css || '', TYPES['.css']);
        return send(res, 200, b.error ? `window.__wfError && window.__wfError(${forScript(b.error)})` : b.js, TYPES['.js']);
      }
      if (p === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(`event: hello\ndata: ${JSON.stringify({ v: st.v })}\n\n`);
        st.clients.add(res);
        const ping = setInterval(() => res.write(': ping\n\n'), 25000);
        req.on('close', () => { clearInterval(ping); st.clients.delete(res); });
        return;
      }
      return send(res, 404, { error: 'Nicht gefunden' });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'Methode nicht erlaubt' });
    const origin = req.headers.origin;
    if (origin && origin !== `http://127.0.0.1:${actualPort}` && origin !== `http://localhost:${actualPort}`) return send(res, 403, { error: 'Fremder Ursprung' });
    const body = await readBody(req);
    const by = String(req.headers['x-wf-client'] || '').slice(0, 40) || null;
    if (p === '/api/op') {
      const m = loadProject(root);
      if (!m.screens[body.ref]) throw new Error(`Screen ${body.ref} nicht gefunden`);
      const r = applyOpRecorded(m, body.ref, body, 'Canvas');
      const files = ownWrite([`${WF}/${body.ref}`], by);
      return send(res, 200, { ok: true, ...r, v: st.v, files });
    }
    if (p === '/api/revert') {
      const r = revertChange(loadProject(root), String(body.id || ''));
      const files = ownWrite([`${WF}/${r.ref}`], by);
      return send(res, 200, { ok: true, ...r, v: st.v, files });
    }
    if (p === '/api/flow') {
      const m = loadProject(root);
      const r = applyFlowOp(m, body.flow, body);
      const f = loadProject(root).flows.find(x => x.id === r.flow);
      const list = [`${WF}/${f.file}`];
      if (r.ref) list.push(`${WF}/${r.ref}`, `${WF}/${r.ref.replace(/\.screen\.tsx$/, '.stories.tsx')}`);
      if (r.wired) list.push(`${WF}/${m.flows.find(x => x.id === r.flow).nodes.find(n => n.id === body.from).ref}`);
      if (r.removed) list.push(`${WF}/${r.removed}`);
      const files = ownWrite(list, by);
      return send(res, 200, { ok: true, ...r, v: st.v, files });
    }
    if (p === '/api/chat') {
      if (!bridge) return send(res, 409, { error: 'Dieser Canvas läuft ohne Claude-Sitzung. Öffne ihn in Claude Code mit /wireflow:canvas.' });
      const m = bridge.userMessage({ text: body.text, selection: body.selection, kind: body.kind });
      return send(res, 200, { ok: true, message: m });
    }
    if (p === '/api/selection') {
      writeSelection(body.selection || null);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/undo') {
      const f = undoLast();
      const files = f ? ownWrite([path.relative(root, f).split(path.sep).join('/')], by) : [];
      return send(res, 200, { ok: true, file: f ? path.relative(root, f) : null, v: st.v, files });
    }
    return send(res, 404, { error: 'Nicht gefunden' });
  };

  const server = http.createServer(async (req, res) => {
    try {
      const host = (req.headers.host || '').toLowerCase();
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) return send(res, 403, 'Host nicht erlaubt', 'text/plain; charset=utf-8');
      const u = new URL(req.url, `http://${host}`);
      const name = `wf_${actualPort}`;
      const authed = cookies(req.headers.cookie)[name] === token;
      if (!authed) {
        if (u.searchParams.get('t') === token && req.method === 'GET') {
          res.writeHead(302, { 'Set-Cookie': `${name}=${token}; HttpOnly; SameSite=Strict; Path=/`, Location: '/', 'Cache-Control': 'no-store' });
          return res.end();
        }
        return send(res, 401, 'Zugang nur über den Link aus Claude Code (wireflow serve oder /wireflow:canvas).', 'text/plain; charset=utf-8');
      }
      await routes(req, res, u);
    } catch (e) {
      if (!res.headersSent) send(res, 400, { error: e.message });
      else res.end();
    }
  });
  server.keepAliveTimeout = 5000;
  actualPort = await listen(server, port ?? (Number(process.env.WIREFLOW_PORT) || 4870));
  const unsubscribe = bridge ? bridge.subscribe(m => broadcast('chat', m)) : () => {};
  const url = `http://127.0.0.1:${actualPort}/?t=${token}`;
  const inst = {
    url,
    port: actualPort,
    token,
    root,
    close: () => new Promise(resolve => {
      unsubscribe();
      watchers.forEach(w => w.close());
      for (const c of st.clients) c.end();
      instances.delete(root);
      server.close(() => resolve());
      server.closeAllConnections?.();
    }),
  };
  instances.set(root, inst);
  return inst;
}

export { readJson };
