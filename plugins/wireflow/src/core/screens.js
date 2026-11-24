// Strukturierte Änderungen an Screen-Modulen – vom Canvas und von Claude.
import fs from 'node:fs';
import path from 'node:path';
import {
  parseModule, printModule, printEl, findById, ensureIds, insertEl, removeEl, moveEl,
  setProp, setText, makeEl, cloneEl, stripIds, indexInParent, getAttr, walk,
} from './jsx.js';
import { components } from './ds.js';
import { writeTracked, WF, loadScreen } from './project.js';
import { lintScreen } from './lint.js';

// Hält „import { flow } from '@wireflow/runtime'“ passend zur Nutzung.
export function ensureRuntimeImport(text) {
  if (!/\bflow\.(trigger|back|vars)\b/.test(text)) return text;
  if (/import\s*\{[^}]*\bflow\b[^}]*\}\s*from\s*['"]@wireflow\/runtime['"]/.test(text)) return text;
  // Ende der letzten Import-Anweisung finden (auch mehrzeilige Imports).
  let end = 0;
  for (const m of text.matchAll(/^import\b[^;]*?(?:from\s*)?['"][^'"\n]+['"];?[ \t]*$/gm)) end = m.index + m[0].length;
  const line = "import { flow } from '@wireflow/runtime';";
  if (!end) return `${line}\n${text}`;
  return `${text.slice(0, end)}\n${line}${text.slice(end)}`;
}

// Screen-Module liegen immer unter .wireflow/screens – nie anderswo schreiben.
export function assertScreenRef(ref) {
  if (typeof ref !== 'string' || !/^screens\/[\w.-]+\.screen\.tsx$/.test(ref) || ref.includes('..')) throw new Error(`Ungültiger Screen-Pfad: ${ref}`);
  return ref;
}

const fmt = (mod, model) =>
  ensureRuntimeImport(printModule(mod, { pkg: model.manifest.package, known: new Set(components(model.manifest).keys()) }));

// Erstes Interaktions-Prop einer Komponente (bevorzugt onPress/onClick).
export function handlerProp(spec) {
  const names = Object.entries(spec?.props || {}).filter(([k, p]) => /^on[A-Z]/.test(k) && ['handler', 'event', 'function', 'action'].includes(p.type)).map(([k]) => k);
  return names.find(n => n === 'onPress' || n === 'onClick') || names.find(n => n !== 'onBack') || null;
}

export function applyOp(model, ref, op) {
  const file = path.join(model.root, WF, assertScreenRef(ref));
  const mod = parseModule(fs.readFileSync(file, 'utf8'));
  const root = mod.root;
  const comps = components(model.manifest);
  const need = id => {
    const hit = findById(root, id);
    if (!hit) throw new Error(`Element ${id} nicht gefunden`);
    return hit;
  };
  let selected = op.id || null;
  switch (op.op) {
    case 'insert': {
      const spec = comps.get(op.component);
      if (!spec) throw new Error(`„${op.component}“ ist keine Komponente des Design Systems`);
      const d = spec.defaults || {};
      const el = makeEl(op.component, { ...(d.props || {}), ...(op.props || {}) }, op.text ?? d.text ?? '');
      const parent = op.parent ? need(op.parent).node : root;
      insertEl(parent, op.index ?? Number.MAX_SAFE_INTEGER, el);
      ensureIds(root);
      selected = getAttr(el, 'data-wf');
      break;
    }
    case 'remove':
      if (!removeEl(root, op.id)) throw new Error(`Element ${op.id} kann nicht entfernt werden`);
      selected = null;
      break;
    case 'move': {
      need(op.id);
      const i = indexInParent(root, op.id);
      const index = op.index ?? i + (op.delta || 0);
      if (index < 0 || !moveEl(root, op.id, op.parent || null, index)) throw new Error('Verschieben nicht möglich');
      break;
    }
    case 'duplicate': {
      const hit = need(op.id);
      if (!hit.parent) throw new Error('Das Wurzelelement lässt sich nicht duplizieren');
      const c = stripIds(cloneEl(hit.node));
      insertEl(hit.parent, indexInParent(root, op.id) + 1, c);
      ensureIds(root);
      selected = getAttr(c, 'data-wf');
      break;
    }
    case 'setProp':
      setProp(need(op.id).node, op.name, op.value);
      break;
    case 'setText':
      setText(need(op.id).node, op.text || '');
      break;
    default:
      throw new Error(`Unbekannte Operation: ${op.op}`);
  }
  ensureIds(root);
  writeTracked(file, fmt(mod, model));
  return { ref, selected };
}

// Verdrahtet ein Element mit flow.trigger('<id>'), falls es noch keinen Handler hat.
export function wireTrigger(model, ref, id) {
  const file = path.join(model.root, WF, assertScreenRef(ref));
  const mod = parseModule(fs.readFileSync(file, 'utf8'));
  const hit = findById(mod.root, id);
  if (!hit) throw new Error(`Element ${id} gibt es in ${ref} nicht`);
  const spec = components(model.manifest).get(hit.node.name);
  const prop = handlerProp(spec);
  if (!prop) return { wired: false, hinweis: `<${hit.node.name}> hat kein Interaktions-Prop – die Verbindung wirkt nur im Wireflow, nicht im Prototyp.` };
  if (getAttr(hit.node, prop) !== undefined) return { wired: false, prop };
  setProp(hit.node, prop, { expr: `flow.trigger('${id}')` });
  writeTracked(file, fmt(mod, model));
  return { wired: true, prop };
}

const pascal = s => s.replace(/(^|[^A-Za-z0-9]+)([A-Za-z0-9])/g, (_, __, c) => c.toUpperCase()).replace(/^[^A-Za-z]+/, '') || 'Neu';
export const slugify = s => String(s || '').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'screen';

// Legt ein neues Screen-Modul samt Story-Datei an – nur aus Komponenten des Design Systems.
export function newScreen(model, { title = 'Neuer Screen', flowTitle = '' } = {}) {
  const comps = model.manifest.components || [];
  const has = intent => comps.find(c => (c.intents || []).some(i => i === intent || i.startsWith(intent + '.')));
  const rootSpec = has('page') || comps.find(c => c.props?.children?.type === 'node') || comps[0];
  if (!rootSpec) throw new Error('Das Design-System-Manifest enthält keine Komponenten.');
  let base = slugify(title);
  let k = 1;
  while (fs.existsSync(path.join(model.wf, 'screens', `${base}.screen.tsx`))) base = `${slugify(title)}-${++k}`;
  const ref = `screens/${base}.screen.tsx`;
  const name = `${pascal(base)}Screen`;
  const root = makeEl(rootSpec.name, rootSpec.defaults?.props || {});
  root.inline = false;
  const heading = has('content.title');
  if (heading) insertEl(root, 0, makeEl(heading.name, heading.defaults?.props || {}, title));
  ensureIds(root);
  const used = [...new Set([rootSpec.name, heading?.name].filter(Boolean))];
  const src = [
    `import { ${used.join(', ')} } from '${model.manifest.package}';`,
    '',
    `export function ${name}() {`,
    '  return (',
    '    ' + printEl(root, '    '),
    '  );',
    '}',
    '',
  ].join('\n');
  const stories = [
    "import type { Meta, StoryObj } from '@storybook/react';",
    `import { ${name} } from './${base}.screen';`,
    '',
    `const meta = { title: '${(flowTitle || 'Wireflow').replace(/'/g, '')}/${base}', component: ${name} } satisfies Meta<typeof ${name}>;`,
    'export default meta;',
    'type Story = StoryObj<typeof meta>;',
    '',
    'export const Standard: Story = {};',
    '',
  ].join('\n');
  writeTracked(path.join(model.wf, ref), src);
  writeTracked(path.join(model.wf, 'screens', `${base}.stories.tsx`), stories);
  return { ref, component: name };
}

// Schreibt ein ganzes Screen-Modul (z. B. von Claude) nach Prüfung.
export function writeScreen(model, ref, source, { force = false } = {}) {
  const file = path.join(model.root, WF, assertScreenRef(ref));
  let mod;
  try {
    mod = parseModule(source);
  } catch (e) {
    return { ok: false, error: `Kein gültiges Screen-Modul: ${e.message}` };
  }
  let missing = false;
  walk(mod.root, n => { if (!getAttr(n, 'data-wf')) missing = true; });
  if (missing) { ensureIds(mod.root); source = fmt(mod, model); }
  const preview = { ref, file, source, tree: mod.root, component: mod.name, stories: [] };
  const lint = lintScreen(preview, model);
  if (lint.errors.length && !force) return { ok: false, lint };
  writeTracked(file, source);
  return { ok: true, lint, screen: loadScreen(model.root, ref) };
}
