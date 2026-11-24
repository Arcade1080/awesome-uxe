// /wireflow:init – legt .wireflow/ an und verknüpft das Design System (erster Entwurf des Manifests).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { WF, readJson } from './project.js';

const write = (file, content) => {
  if (fs.existsSync(file)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n');
  return true;
};

// Findet das Verzeichnis eines Pakets aus Sicht des Projekts (auch Workspaces).
export function packageDir(root, pkg) {
  const req = createRequire(path.join(root, 'package.json'));
  try {
    return path.dirname(fs.realpathSync(req.resolve(`${pkg}/package.json`)));
  } catch {
    for (const dir of [path.join(root, 'node_modules', pkg)]) if (fs.existsSync(path.join(dir, 'package.json'))) return fs.realpathSync(dir);
    return null;
  }
}

// Exportierte Komponenten (Großbuchstabe) aus dem Einstieg eines Pakets – folgt relativen Re-Exporten.
export function scanExports(dir) {
  const pj = readJson(path.join(dir, 'package.json'), {});
  const exp = pj.exports?.['.'];
  const entry = [typeof exp === 'string' ? exp : exp?.source || exp?.import || exp?.default, pj.source, pj.module, pj.main, 'src/index.ts', 'src/index.tsx', 'index.ts', 'index.js']
    .filter(x => typeof x === 'string')
    .map(x => path.join(dir, x))
    .find(f => fs.existsSync(f));
  const names = new Set();
  const seen = new Set();
  const visit = (file, depth) => {
    if (!file || seen.has(file) || depth > 4) return;
    seen.add(file);
    let src;
    try { src = fs.readFileSync(file, 'utf8'); } catch { return; }
    for (const m of src.matchAll(/export\s+(?:default\s+)?(?:function|const|class)\s+([A-Z][\w$]*)/g)) names.add(m[1]);
    for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const part of m[1].split(',')) {
        const n = part.trim().split(/\s+as\s+/).pop()?.trim();
        if (n && /^[A-Z]/.test(n) && !/^type\s/.test(part.trim())) names.add(n);
      }
    }
    for (const m of src.matchAll(/export\s+\*\s+from\s+['"](\.[^'"]+)['"]/g)) visit(resolveRel(path.dirname(file), m[1]), depth + 1);
  };
  visit(entry, 0);
  return { entry: entry ? path.relative(dir, entry) : null, components: [...names].sort() };
}

function resolveRel(dir, spec) {
  const base = path.resolve(dir, spec);
  for (const f of [base, ...['.ts', '.tsx', '.js', '.jsx'].map(e => base + e), ...['index.ts', 'index.tsx', 'index.js'].map(e => path.join(base, e))]) {
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
  }
  return null;
}

export function initProject(root, { name, dsPackage } = {}) {
  const wf = path.join(root, WF);
  const created = [];
  const rootPkg = readJson(path.join(root, 'package.json'), {});
  const projectName = name || rootPkg.name || path.basename(root);
  const mk = (rel, content) => { if (write(path.join(wf, rel), content)) created.push(`${WF}/${rel}`); };
  mk('project.json', {
    schema: 'wireflow/project@1',
    name: projectName,
    designSystem: { manifest: 'ds/manifest.json' },
    renderer: { framework: 'react', viewport: { width: 360, height: 740 } },
    screens: { allowedImports: [], allowExperimental: false },
  });
  let ds = null;
  if (dsPackage) {
    const dir = packageDir(root, dsPackage);
    const scan = dir ? scanExports(dir) : { entry: null, components: [] };
    const pj = dir ? readJson(path.join(dir, 'package.json'), {}) : {};
    const tokenFiles = dir ? findTokenFiles(dir).map(f => path.relative(root, f)) : [];
    ds = { package: dsPackage, gefunden: !!dir, einstieg: scan.entry, komponenten: scan.components.length, tokenDateien: tokenFiles };
    mk('ds/manifest.json', {
      schema: 'wireflow/ds-manifest@1',
      name: pj.description?.split(/[–-]/)[0]?.trim() || dsPackage,
      package: dsPackage,
      version: pj.version || '',
      styles: [],
      tokens: { files: tokenFiles, modes: {} },
      components: scan.components.map(n => ({ name: n, status: 'stable', description: '', props: {}, intents: [], guidelines: [], a11y: [] })),
      gaps: [],
      _todo: 'Entwurf aus den Exporten. Props, Intents, Richtlinien, Defaults und styles ergänzt der ds-curator (/wireflow:ds).',
    });
  } else {
    mk('ds/manifest.json', { schema: 'wireflow/ds-manifest@1', name: '', package: '', styles: [], tokens: { files: [], modes: {} }, components: [], gaps: [] });
  }
  for (const k of ['insights', 'assumptions', 'questions']) mk(`knowledge/${k}.json`, []);
  for (const d of ['flows', 'journeys', 'screens', 'fixtures', 'decisions', 'ds/patterns', 'research']) {
    const dir = path.join(wf, d);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, '.gitkeep'), ''); created.push(`${WF}/${d}/`); }
  }
  mk('.gitignore', '.canvas-state.json\n');
  return { root, created, designSystem: ds };
}

function findTokenFiles(dir) {
  const out = [];
  const walkDir = (d, depth) => {
    if (depth > 3) return;
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walkDir(p, depth + 1);
      else if (/\.tokens\.json$|^tokens\.json$/.test(e.name)) out.push(p);
    }
  };
  walkDir(dir, 0);
  return out.slice(0, 20);
}
