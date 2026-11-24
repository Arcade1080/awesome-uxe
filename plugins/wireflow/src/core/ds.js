// Design System: Manifest, Suche, Tokens.
import fs from 'node:fs';
import path from 'node:path';

export function components(manifest) {
  return new Map((manifest?.components || []).map(c => [c.name, c]));
}

const norm = s => String(s || '').toLowerCase();

export function searchDs(model, query) {
  const q = norm(query).split(/\s+/).filter(Boolean);
  const hit = text => q.every(t => norm(text).includes(t));
  const out = [];
  for (const c of model.manifest.components || []) {
    const hay = [c.name, c.description, ...(c.intents || []), ...(c.guidelines || []), ...(c.keywords || [])].join(' ');
    if (!q.length || hit(hay)) out.push({ kind: 'component', name: c.name, status: c.status || 'stable', description: c.description || '', intents: c.intents || [] });
  }
  for (const p of model.patterns) {
    if (!q.length || hit(p.text)) out.push({ kind: 'pattern', name: p.meta.name || p.id, id: p.id, file: p.file });
  }
  return out;
}

// ---------- Tokens (DTCG) ----------
export const cssVar = p => '--' + p.replace(/\./g, '-');

export function flattenTokens(obj, prefix = [], type, out = []) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (k.startsWith('$')) continue;
    if (v && typeof v === 'object' && '$value' in v) out.push({ path: [...prefix, k].join('.'), type: v.$type || type, value: v.$value });
    else if (v && typeof v === 'object') flattenTokens(v, [...prefix, k], v.$type || type, out);
  }
  return out;
}

export function formatValue(v) {
  if (v == null) return '';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && 'hex' in v) return v.hex;
  if (typeof v === 'object' && 'value' in v && 'unit' in v) return `${v.value}${v.unit}`;
  if (Array.isArray(v)) return v.map(formatValue).join(', ');
  return '';
}

function resolve(tokens) {
  const map = new Map(tokens.map(t => [t.path, t]));
  const val = (t, depth = 0) => {
    if (typeof t.value === 'string') {
      const m = /^\{([^}]+)\}$/.exec(t.value);
      if (m && map.has(m[1]) && depth < 10) return val(map.get(m[1]), depth + 1);
    }
    return formatValue(t.value);
  };
  return tokens.map(t => ({ ...t, css: val(t) }));
}

export function loadTokens(model) {
  const files = [].concat(model.manifest.tokens?.files || []);
  const all = [];
  for (const f of files) {
    const file = path.resolve(model.root, f);
    if (fs.existsSync(file)) flattenTokens(JSON.parse(fs.readFileSync(file, 'utf8')), [], undefined, all);
  }
  return resolve(all);
}

export function tokensCss(model) {
  const toks = loadTokens(model);
  const base = toks.map(t => `${cssVar(t.path)}:${t.css}`).join(';');
  const modes = Object.entries(model.manifest.tokens?.modes || {})
    .map(([mode, vals]) => `[data-wf-mode="${mode}"]{${Object.entries(vals).map(([k, v]) => `${cssVar(k)}:${v}`).join(';')}}`)
    .join('\n');
  return `:root{${base}}\n${modes}`;
}
