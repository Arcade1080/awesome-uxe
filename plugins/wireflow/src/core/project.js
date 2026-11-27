// Projektmodell: liest und schreibt alles unter .wireflow/ im Repo.
import fs from 'node:fs';
import path from 'node:path';
import { parseModule } from './jsx.js';
import { normalizeJourney } from './journey.js';

export const WF = '.wireflow';

export function findRoot(start = process.env.CLAUDE_PROJECT_DIR || process.cwd()) {
  let d = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(d, WF, 'project.json'))) return d;
    const p = path.dirname(d);
    if (p === d) return null;
    d = p;
  }
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (fallback !== undefined && e.code === 'ENOENT') return fallback;
    throw new Error(`${path.basename(file)}: ${e.message}`);
  }
}

export function listFiles(dir, suffix) {
  try {
    return fs.readdirSync(dir).filter(f => f.endsWith(suffix)).sort().map(f => path.join(dir, f));
  } catch {
    return [];
  }
}

// Sehr kleiner Frontmatter-Leser: nur Schlüssel mit einfachem Wert auf oberster Ebene.
export function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const mm = /^([A-Za-z_][\w-]*):\s*(.+)$/.exec(line);
    if (mm && !mm[2].startsWith('#')) out[mm[1]] = mm[2].replace(/\s+#.*$/, '').replace(/^['"]|['"]$/g, '').trim();
  }
  return out;
}

// ---------- Schreiben mit Verlauf (für Rückgängig) ----------
const history = [];
export function writeTracked(file, content) {
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (prev === content) return false;
  history.push({ file, prev });
  if (history.length > 100) history.shift();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return true;
}
export function removeTracked(file) {
  if (!fs.existsSync(file)) return false;
  history.push({ file, prev: fs.readFileSync(file, 'utf8') });
  if (history.length > 100) history.shift();
  fs.rmSync(file);
  return true;
}
export function writeJson(file, data) {
  return writeTracked(file, JSON.stringify(data, null, 2) + '\n');
}
export function undoLast() {
  const h = history.pop();
  if (!h) return null;
  if (h.prev === null) fs.rmSync(h.file, { force: true });
  else fs.writeFileSync(h.file, h.prev);
  return h.file;
}

// ---------- Laden ----------
export function storyNames(file) {
  if (!fs.existsSync(file)) return [];
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/export\s+const\s+([A-Z][\w$]*)\s*[:=]/g)].map(m => m[1]);
}

export function loadScreen(root, ref) {
  const file = path.join(root, WF, ref);
  const storiesFile = file.replace(/\.screen\.tsx$/, '.stories.tsx');
  const info = { ref, file, storiesFile: fs.existsSync(storiesFile) ? storiesFile : null, stories: storyNames(storiesFile) };
  try {
    info.source = fs.readFileSync(file, 'utf8');
  } catch {
    info.error = `Datei fehlt: ${ref}`;
    return info;
  }
  try {
    const mod = parseModule(info.source);
    info.component = mod.name;
    info.tree = mod.root;
  } catch (e) {
    info.error = e.message;
  }
  return info;
}

export function loadProject(root) {
  if (!root) throw new Error('Kein Wireflow-Projekt gefunden. Mit /wireflow:init anlegen.');
  const wf = path.join(root, WF);
  const project = readJson(path.join(wf, 'project.json'));
  const manifestFile = path.join(wf, project.designSystem?.manifest || 'ds/manifest.json');
  const manifest = readJson(manifestFile, { components: [] });
  const patterns = listFiles(path.join(wf, 'ds', 'patterns'), '.md').map(file => {
    const text = fs.readFileSync(file, 'utf8');
    return { id: path.basename(file, '.md'), file: path.relative(wf, file), text, meta: frontmatter(text) };
  });
  const flows = listFiles(path.join(wf, 'flows'), '.flow.json').map(file => ({ ...readJson(file), file: path.relative(wf, file) }));
  const journeys = listFiles(path.join(wf, 'journeys'), '.journey.json').map(file => normalizeJourney({ ...readJson(file), file: path.relative(wf, file) }));
  const refs = new Set(listFiles(path.join(wf, 'screens'), '.screen.tsx').map(f => path.relative(wf, f)));
  flows.forEach(f => (f.nodes || []).forEach(n => { if (n.ref) refs.add(n.ref); }));
  const screens = Object.fromEntries([...refs].sort().map(ref => [ref, loadScreen(root, ref)]));
  const k = name => readJson(path.join(wf, 'knowledge', `${name}.json`), []);
  const knowledge = { insights: k('insights'), assumptions: k('assumptions'), questions: k('questions') };
  return { root, wf, project, manifestFile, manifest, patterns, flows, journeys, screens, knowledge };
}

export function flowById(model, id) {
  return model.flows.find(f => f.id === id) || (id ? null : model.flows[0]) || null;
}
