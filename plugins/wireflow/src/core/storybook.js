// Storybook als Renderer: Wireflow liest den Story-Index eines laufenden Storybooks
// (index.json) und zeigt die Stories des Projekts als Frames im Canvas – ohne Migration.
// Gesucht wird nur auf diesem Rechner (Loopback); die URL lässt sich in project.json
// unter storybook.url oder mit WIREFLOW_STORYBOOK_URL festlegen.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

export const STORYBOOK_PORTS = [6006, 6007, 6008];
const SCREEN_GROUP = /^(screens?|pages?|views?|flows?|seiten|ansichten)$/i;
const SCREEN_DIR = /(^|\/)(screens?|pages?|views?)\//i;
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);

export function normalizeStorybookUrl(u) {
  if (!u) return null;
  try {
    const x = new URL(String(u));
    if (!/^https?:$/.test(x.protocol) || !LOCAL.has(x.hostname)) return null;
    return `${x.protocol}//${x.host}`;
  } catch {
    return null;
  }
}

// Einstellungen aus .wireflow/project.json → storybook { url, screens }.
export function storybookSettings(model) {
  const c = model?.project?.storybook || {};
  const raw = process.env.WIREFLOW_STORYBOOK_URL || c.url || null;
  return {
    url: normalizeStorybookUrl(raw),
    invalidUrl: raw && !normalizeStorybookUrl(raw) ? String(raw) : null,
    screens: Array.isArray(c.screens) ? c.screens.map(String).filter(Boolean) : [],
  };
}

export function getJson(url, timeout = 900) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    try {
      const req = http.get(url, { timeout, headers: { accept: 'application/json' } }, res => {
        if (res.statusCode !== 200) { res.resume(); return finish(null); }
        const chunks = [];
        let size = 0;
        res.on('data', c => { size += c.length; if (size > 30_000_000) { req.destroy(); finish(null); } else chunks.push(c); });
        res.on('end', () => { try { finish(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { finish(null); } });
        res.on('error', () => finish(null));
      });
      req.on('timeout', () => { req.destroy(); finish(null); });
      req.on('error', () => finish(null));
    } catch {
      finish(null);
    }
  });
}

const isIndex = d => d && typeof d === 'object' && d.entries && typeof d.entries === 'object' && Number(d.v) >= 4;

// Verzeichnisse mit .storybook/ im Projekt (bis Tiefe 3, ohne node_modules).
export function storybookDirs(root) {
  const out = [];
  const walk = (dir, depth) => {
    let list;
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (list.some(d => d.isDirectory() && d.name === '.storybook')) out.push(dir);
    if (depth >= 3) return;
    for (const d of list) {
      if (!d.isDirectory() || d.name.startsWith('.') || /^(node_modules|dist|build|coverage|storybook-static)$/.test(d.name)) continue;
      walk(path.join(dir, d.name), depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

// Zu welchem Verzeichnis gehören die importPath-Angaben des Index? null = fremdes Storybook.
function baseOf(root, index, dirs) {
  const paths = Object.values(index.entries).map(e => e.importPath).filter(Boolean).slice(0, 5);
  if (!paths.length) return '';
  for (const dir of [root, ...dirs]) {
    if (paths.some(p => fs.existsSync(path.resolve(dir, p)))) return path.relative(root, dir).split(path.sep).join('/');
  }
  return null;
}

// Laufendes Storybook finden: zuerst die eingestellte URL, sonst die üblichen Ports.
export async function findStorybook(root, settings, { dirs, candidates: given } = {}) {
  const candidates = settings.url ? [settings.url] : given || STORYBOOK_PORTS.flatMap(p => [`http://127.0.0.1:${p}`, `http://[::1]:${p}`]);
  const results = await Promise.all(candidates.map(u => getJson(`${u}/index.json`)));
  const projectDirs = dirs || storybookDirs(root);
  for (let i = 0; i < candidates.length; i++) {
    const index = results[i];
    if (!isIndex(index)) continue;
    const base = baseOf(root, index, projectDirs);
    if (base === null && !settings.url) continue;
    return { url: candidates[i], index, base: base || '' };
  }
  return null;
}

const relTo = (base, p) => (p ? path.posix.normalize(path.posix.join(base || '', p)).replace(/^\.\//, '') : null);

function isScreen(g, settings) {
  if (settings.screens?.length) return settings.screens.some(p => g.title === p.replace(/\/$/, '') || g.title.startsWith(p.endsWith('/') ? p : `${p}/`));
  if (SCREEN_GROUP.test(g.title.split('/')[0].trim())) return true;
  return SCREEN_DIR.test(g.file || '') || SCREEN_DIR.test(g.component || '');
}

// Stories nach Komponente (title) gruppiert, in der Reihenfolge des Index.
export function storyGroups(index, { base = '', settings = {} } = {}) {
  const groups = new Map();
  for (const e of Object.values(index?.entries || {})) {
    if (e.type !== 'story') continue;
    let g = groups.get(e.title);
    if (!g) groups.set(e.title, (g = { title: e.title, file: relTo(base, e.importPath), component: relTo(base, e.componentPath), screen: false, stories: [] }));
    g.stories.push({ id: e.id, name: e.name, exportName: e.exportName || null, tags: (e.tags || []).filter(t => !/^(dev|test|manifest|autodocs)$/.test(t)) });
  }
  const list = [...groups.values()];
  for (const g of list) g.screen = isScreen(g, settings);
  return list;
}

export function storybookHint(dirs) {
  return dirs.length
    ? `Storybook ist eingerichtet (${dirs.map(d => d || '.').join(', ')}), läuft aber nicht. Im Projekt starten, z. B. „npm run storybook“ – Wireflow verbindet sich von selbst (Ports ${STORYBOOK_PORTS.join(', ')} oder storybook.url in .wireflow/project.json).`
    : 'Kein Storybook im Projekt gefunden. Mit Storybook zeigt der Canvas die bestehenden Stories ohne Migration.';
}

// Kompakte Übersicht für Claude (MCP) und die Diagnose.
export async function storybookStatus(root, model) {
  const settings = storybookSettings(model);
  const dirs = storybookDirs(root).map(d => path.relative(root, d).split(path.sep).join('/'));
  const found = await findStorybook(root, settings, { dirs: dirs.map(d => path.join(root, d)) });
  if (!found) return { verbunden: false, url: settings.url, eingerichtet: dirs, hinweis: settings.invalidUrl ? `storybook.url „${settings.invalidUrl}“ wird ignoriert: nur http(s) auf localhost, 127.0.0.1 oder [::1].` : storybookHint(dirs) };
  const groups = storyGroups(found.index, { base: found.base, settings });
  return {
    verbunden: true,
    url: found.url,
    eingerichtet: dirs,
    stories: groups.reduce((n, g) => n + g.stories.length, 0),
    screens: groups.filter(g => g.screen).map(g => g.title),
    gruppen: groups,
  };
}
