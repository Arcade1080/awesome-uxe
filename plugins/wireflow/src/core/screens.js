// Strukturierte Änderungen an Screen-Modulen – vom Canvas und von Claude.
import fs from 'node:fs';
import path from 'node:path';
import {
  parseModule, parseElement, printModule, printEl, findById, ensureIds, insertEl, removeEl, moveEl,
  setProp, setText, makeEl, cloneEl, stripIds, indexInParent, getAttr, walk, textOf,
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

// Position unter den Element-Kindern von parent: direkt nach dem Anker (after), sonst index.
function anchoredIndex(parent, after, fallback, skipId) {
  const kids = parent.children.filter(c => c.type === 'el' && getAttr(c, 'data-wf') !== skipId);
  if (after === null) return 0;
  const a = after ? kids.findIndex(c => getAttr(c, 'data-wf') === after) : -1;
  return a >= 0 ? a + 1 : Math.min(fallback ?? kids.length, kids.length);
}


// Pflicht-Props ohne Standardwert bekommen beim Einfügen einen Platzhalter, damit die
// Komponente rendert. Gibt die gefüllten Namen zurück (für den Hinweis im Canvas).
const LABELS = { title: 'Titel', label: 'Beschriftung', 'aria-label': 'Beschriftung', description: 'Beschreibung', text: 'Text', heading: 'Überschrift', placeholder: 'Platzhalter', name: 'feld', value: 'wert', datetime: '2026-01-01T09:00:00Z' };
export function placeholderFor(name, ps, component) {
  if (ps.default !== undefined) return ps.default;
  if (ps.enum?.length) return ps.enum[0];
  if (ps.type === 'boolean') return false;
  if (ps.type === 'number') return 1;
  if (ps.type === 'string' || ps.type === 'node') return LABELS[name] || `${component} ${name}`;
  if (ps.type === 'code' && /\[\]\s*$|Array</.test(ps.ts || '')) return { expr: '[]' };
  return undefined;
}
function fillRequired(n, spec, filled = []) {
  for (const [k, ps] of Object.entries(spec.props || {})) {
    if (k === 'children' || !ps.required || n.attrs.some(a => a.name === k)) continue;
    const v = placeholderFor(k, ps, spec.name);
    if (v === undefined || v === false) continue;
    setProp(n, k, v);
    filled.push(k);
  }
  return filled;
}
// Unterkomponenten (Name.Teil) gehören in ihre Komponente – sonst fehlt ihr der Kontext.
function assertInsideParent(root, parentNode, name) {
  const base = name.includes('.') ? name.split('.')[0] : null;
  if (!base) return;
  let inside = false;
  const visit = (n, anc) => { if (n === parentNode) inside = [...anc, n].some(a => a.name === base || a.name.startsWith(`${base}.`)); else n.children?.forEach(c => c.type === 'el' && visit(c, [...anc, n])); };
  visit(root, []);
  if (!inside) throw new Error(`${name} gehört in eine <${base}> – dort einfügen oder <${base}> verwenden.`);
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
  let filled = [];
  switch (op.op) {
    case 'insert': {
      const spec = comps.get(op.component);
      if (!spec) throw new Error(`„${op.component}“ ist keine Komponente des Design Systems`);
      const d = spec.defaults || {};
      const el = makeEl(op.component, { ...(d.props || {}), ...(op.props || {}) }, op.text ?? d.text ?? (['node', 'string'].includes(spec.props?.children?.type) && spec.props.children.required ? op.component.split('.').pop() : ''));
      filled = fillRequired(el, spec);
      const parent = op.parent ? need(op.parent).node : root;
      assertInsideParent(root, parent, op.component);
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
      const cur = need(op.id);
      const i = indexInParent(root, op.id);
      const target = op.parent ? need(op.parent).node : cur.parent;
      const index = 'after' in op ? anchoredIndex(target, op.after, op.index, op.id) : op.index ?? i + (op.delta || 0);
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
    case 'swap': {
      // Komponente tauschen: Props, die die neue Komponente kennt, bleiben; Pflicht-Props aus den Defaults.
      const hit = need(op.id);
      const to = comps.get(op.component);
      if (!to) throw new Error(`„${op.component}“ ist keine Komponente des Design Systems`);
      const n = hit.node;
      n.name = op.component;
      n.attrs = n.attrs.filter(a => a.kind === 'spread' || a.name === 'data-wf' || a.name === 'key' || /^aria-/.test(a.name || '') || to.props?.[a.name]);
      for (const [k, ps] of Object.entries(to.props || {})) {
        if (k === 'children' || !ps.required || n.attrs.some(a => a.name === k)) continue;
        const d = to.defaults?.props?.[k];
        if (d !== undefined) setProp(n, k, d);
      }
      filled = fillRequired(n, to);
      if (!to.props?.children && n.children.length) { n.children = []; n.inline = true; n.innerRaw = null; }
      else if (to.props?.children?.type === 'string' && n.children.some(c => c.type === 'el')) setText(n, textOf(n) || to.defaults?.text || '');
      else if (to.props?.children?.type === 'string' && !n.children.length && to.defaults?.text) setText(n, to.defaults.text);
      break;
    }
    case 'replaceRaw': {
      const hit = need(op.id);
      if (!hit.parent) throw new Error('Das Wurzelelement lässt sich nicht ersetzen');
      const el = parseElement(op.jsx);
      hit.parent.children.splice(hit.parent.children.indexOf(hit.node), 1, el);
      break;
    }
    case 'insertRaw': {
      // Wiederherstellen eines entfernten Elements (Rückgängig je Eintrag)
      const el = parseElement(op.jsx);
      const parent = op.parent ? need(op.parent).node : root;
      insertEl(parent, 'after' in op ? anchoredIndex(parent, op.after, op.index) : op.index ?? Number.MAX_SAFE_INTEGER, el);
      selected = getAttr(el, 'data-wf');
      break;
    }
    default:
      throw new Error(`Unbekannte Operation: ${op.op}`);
  }
  ensureIds(root);
  writeTracked(file, fmt(mod, model));
  return { ref, selected, ...(filled.length ? { filled } : {}) };
}

// Beschreibt eine Operation vor dem Ausführen: Text für die Änderungsliste und Gegenoperation.
const shown = a => {
  if (!a) return 'nicht gesetzt';
  if (a.kind === 'bool') return 'an';
  if (a.kind === 'str') return a.raw;
  return `{${a.raw}}`;
};
const asValue = a => (!a ? null : a.kind === 'bool' ? true : a.kind === 'str' ? a.raw : { expr: a.raw });
const prevSiblingId = (parent, node) => {
  const kids = parent.children.filter(c => c.type === 'el');
  const i = kids.indexOf(node);
  return i > 0 ? getAttr(kids[i - 1], 'data-wf') || null : null;
};
export function planChange(model, ref, op) {
  const file = path.join(model.root, WF, assertScreenRef(ref));
  const root = parseModule(fs.readFileSync(file, 'utf8')).root;
  const hit = op.id ? findById(root, op.id) : null;
  const n = hit?.node;
  const who = n ? `${n.name} ${op.id}` : op.component || '';
  switch (op.op) {
    case 'setProp': {
      const before = n?.attrs.find(a => a.name === op.name);
      const after = op.value === undefined || op.value === null || op.value === false ? 'nicht gesetzt' : typeof op.value === 'object' && 'expr' in op.value ? `{${op.value.expr}}` : typeof op.value === 'object' ? JSON.stringify(op.value) : String(op.value);
      return { label: `${who} · ${op.name}: ${shown(before)} → ${after}`, inverse: { op: 'setProp', id: op.id, name: op.name, value: asValue(before) } };
    }
    case 'setText':
      return { label: `${who} · Text: „${textOf(n)}“ → „${op.text || ''}“`, inverse: { op: 'setText', id: op.id, text: textOf(n) } };
    case 'insert':
      return { label: `${op.component} eingefügt`, inverse: null };
    case 'duplicate':
      return { label: `${who} dupliziert`, inverse: null };
    case 'remove':
      return { label: `${who} entfernt`, inverse: hit?.parent ? { op: 'insertRaw', parent: getAttr(hit.parent, 'data-wf'), after: prevSiblingId(hit.parent, n), index: indexInParent(root, op.id), jsx: printEl(n, '') } : null };
    case 'move':
      return { label: `${who} verschoben`, inverse: hit?.parent ? { op: 'move', id: op.id, parent: getAttr(hit.parent, 'data-wf'), after: prevSiblingId(hit.parent, n), index: indexInParent(root, op.id) } : null };
    case 'swap':
      return { label: `${who} → ${op.component} getauscht`, inverse: n ? { op: 'replaceRaw', id: op.id, jsx: printEl(n, '') } : null };
    default:
      return { label: `${op.op} ${op.id || ''}`.trim(), inverse: null };
  }
}

// ---------- Änderungsliste (Canvas und Claude) mit Rückgängig je Eintrag ----------
const changes = [];
let changeSeq = 0;
export function changeLog() {
  return changes;
}
export function applyOpRecorded(model, ref, op, by = null) {
  let plan = null;
  try { plan = planChange(model, ref, op); } catch { plan = null; }
  const r = applyOp(model, ref, op);
  const inverse = plan?.inverse || ((op.op === 'insert' || op.op === 'duplicate') && r.selected ? { op: 'remove', id: r.selected } : null);
  const label = op.op === 'insert' ? `${op.component} ${r.selected} eingefügt` : op.op === 'duplicate' ? `${plan?.label || op.id} → ${r.selected}` : plan?.label || op.op;
  changes.push({ id: `ch${++changeSeq}`, time: new Date().toISOString(), ref, label, inverse, by, reverted: false });
  if (changes.length > 60) changes.splice(0, changes.length - 60);
  return r;
}
export function revertChange(model, id) {
  const e = changes.find(c => c.id === id);
  if (!e) throw new Error('Änderung nicht gefunden');
  if (e.reverted) throw new Error('Diese Änderung ist schon rückgängig gemacht');
  if (!e.inverse) throw new Error('Diese Änderung lässt sich nur mit ⌘/Strg+Z rückgängig machen');
  const r = applyOp(model, e.ref, e.inverse);
  e.reverted = true;
  return { ...r, ref: e.ref, label: e.label };
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
  // Ohne Intents im Manifest: übliche Namen für Seiten-Container und Titel.
  const byName = re => comps.find(c => !c.name.includes('.') && re.test(c.name) && c.status !== 'deprecated');
  const rootSpec = has('page') || byName(/^(Page|Screen|Stack|VStack|Box|Layout|Container|Flex)$/) || comps.find(c => c.props?.children?.type === 'node') || comps[0];
  if (!rootSpec) throw new Error('Das Design-System-Manifest enthält keine Komponenten.');
  let base = slugify(title);
  let k = 1;
  while (fs.existsSync(path.join(model.wf, 'screens', `${base}.screen.tsx`))) base = `${slugify(title)}-${++k}`;
  const ref = `screens/${base}.screen.tsx`;
  const name = `${pascal(base)}Screen`;
  const root = makeEl(rootSpec.name, rootSpec.defaults?.props || {});
  root.inline = false;
  const heading = has('content.title') || byName(/^(Heading|Title|PageTitle)$/);
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
