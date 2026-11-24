// Code-Brücke: liest Screen-Module (TSX-Teilmenge) als Baum ein, bearbeitet sie
// strukturiert und schreibt sie deterministisch zurück. Alles außerhalb der
// Regeln bleibt als Code-Block (Ausdruck) unverändert erhalten.

export class ParseError extends Error {}

// Überspringt einen ausgeglichenen {...}-Ausdruck ab s[i] === '{' und liefert
// den Index hinter der schließenden Klammer. Beachtet Strings, Template-Literale
// mit ${…} und Kommentare.
export function scanExpr(s, i) {
  const stack = [{ t: 'code', d: 0 }];
  for (let k = i; k < s.length; k++) {
    const f = stack[stack.length - 1];
    const ch = s[k];
    if (f.t === 'tpl') {
      if (ch === '\\') { k++; continue; }
      if (ch === '`') { stack.pop(); continue; }
      if (ch === '$' && s[k + 1] === '{') { stack.push({ t: 'code', d: 1 }); k++; }
      continue;
    }
    if (ch === '"' || ch === "'") {
      k++;
      while (k < s.length && s[k] !== ch) { if (s[k] === '\\') k++; k++; }
      continue;
    }
    if (ch === '`') { stack.push({ t: 'tpl' }); continue; }
    if (ch === '/' && s[k + 1] === '/') { const e = s.indexOf('\n', k); k = e < 0 ? s.length : e; continue; }
    if (ch === '/' && s[k + 1] === '*') { const e = s.indexOf('*/', k + 2); k = e < 0 ? s.length : e + 1; continue; }
    if (ch === '{') { f.d++; continue; }
    if (ch === '}') {
      f.d--;
      if (f.d === 0) {
        if (stack.length === 1) return k + 1;
        stack.pop();
      }
    }
  }
  throw new ParseError('Ausdruck nicht geschlossen');
}

class Parser {
  constructor(s, i) { this.s = s; this.i = i; }
  err(msg) { throw new ParseError(`${msg} (Zeile ${this.s.slice(0, this.i).split('\n').length})`); }
  ws() { while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++; }
  name() {
    const m = /^[A-Za-z_$][\w$.-]*/.exec(this.s.slice(this.i, this.i + 120));
    if (!m) this.err('Name erwartet');
    this.i += m[0].length;
    return m[0];
  }
  element() {
    const start = this.i;
    if (this.s[this.i] !== '<') this.err('„<“ erwartet');
    this.i++;
    if (this.s[this.i] === '>') this.err('Fragmente (<>…</>) werden in Screen-Modulen nicht unterstützt');
    const name = this.name();
    const attrs = [];
    for (;;) {
      this.ws();
      const c = this.s[this.i];
      if (c === undefined) this.err(`<${name}> nicht geschlossen`);
      if (c === '/' && this.s[this.i + 1] === '>') { this.i += 2; return { type: 'el', name, attrs, children: [], start, end: this.i }; }
      if (c === '>') { this.i++; break; }
      if (c === '{') {
        const e = scanExpr(this.s, this.i);
        attrs.push({ name: null, kind: 'spread', raw: this.s.slice(this.i + 1, e - 1).trim() });
        this.i = e;
        continue;
      }
      const an = this.name();
      this.ws();
      if (this.s[this.i] !== '=') { attrs.push({ name: an, kind: 'bool' }); continue; }
      this.i++;
      this.ws();
      const q = this.s[this.i];
      if (q === '"' || q === "'") {
        const e = this.s.indexOf(q, this.i + 1);
        if (e < 0) this.err('String nicht geschlossen');
        attrs.push({ name: an, kind: 'str', raw: this.s.slice(this.i + 1, e), quote: q });
        this.i = e + 1;
      } else if (q === '{') {
        const e = scanExpr(this.s, this.i);
        attrs.push({ name: an, kind: 'expr', raw: this.s.slice(this.i + 1, e - 1).trim() });
        this.i = e;
      } else this.err(`Wert für ${an} erwartet`);
    }
    const innerStart = this.i;
    const children = [];
    let innerEnd = this.i;
    for (;;) {
      const c = this.s[this.i];
      if (c === undefined) this.err(`</${name}> fehlt`);
      if (c === '<' && this.s[this.i + 1] === '/') {
        innerEnd = this.i;
        this.i += 2;
        const cn = this.name();
        if (cn !== name) this.err(`</${name}> erwartet, </${cn}> gefunden`);
        this.ws();
        if (this.s[this.i] !== '>') this.err('„>“ erwartet');
        this.i++;
        break;
      }
      if (c === '<') { children.push(this.element()); continue; }
      if (c === '{') {
        const e = scanExpr(this.s, this.i);
        children.push({ type: 'expr', raw: this.s.slice(this.i + 1, e - 1).trim() });
        this.i = e;
        continue;
      }
      let j = this.i;
      while (j < this.s.length && this.s[j] !== '<' && this.s[j] !== '{') j++;
      const text = this.s.slice(this.i, j).replace(/\s+/g, ' ').trim();
      this.i = j;
      if (text) children.push({ type: 'text', value: text });
    }
    const innerRaw = this.s.slice(innerStart, innerEnd);
    const inline = !children.some(c => c.type === 'el') && !innerRaw.includes('\n');
    return { type: 'el', name, attrs, children, start, end: this.i, inline, innerRaw: inline ? innerRaw : null };
  }
}

export function parseElement(src) {
  const p = new Parser(src.trim(), 0);
  return p.element();
}

// Liest ein Screen-Modul: exportierte Funktion, deren return(...) JSX liefert.
export function parseModule(src) {
  const m = /export\s+(?:default\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(src);
  if (!m) throw new ParseError('Kein exportierter Screen gefunden (export function …)');
  let r = src.indexOf('return', m.index);
  if (r < 0) throw new ParseError('Kein return im Screen gefunden');
  let k = r + 6;
  while (/\s/.test(src[k])) k++;
  if (src[k] === '(') { k++; while (/\s/.test(src[k])) k++; }
  if (src[k] !== '<') throw new ParseError('return liefert kein JSX');
  const p = new Parser(src, k);
  const root = p.element();
  const lineStart = src.lastIndexOf('\n', k - 1) + 1;
  const lead = src.slice(lineStart, k);
  return { src, name: m[1], root, prefix: src.slice(0, k), suffix: src.slice(p.i), baseInd: /^\s*$/.test(lead) ? lead : '' };
}

const collapse = raw => (raw.includes('`') ? raw : raw.replace(/\s*\n\s*/g, ' '));

function printAttr(a) {
  if (a.kind === 'spread') return `{${a.raw}}`;
  if (a.kind === 'bool') return a.name;
  if (a.kind === 'str') return `${a.name}=${a.quote || '"'}${a.raw}${a.quote || '"'}`;
  return `${a.name}={${collapse(a.raw)}}`;
}

export function printEl(n, ind = '') {
  const attrs = n.attrs.map(printAttr);
  const open = `<${n.name}${attrs.length ? ' ' + attrs.join(' ') : ''}`;
  if (!n.children.length) return `${open} />`;
  if (n.inline && n.innerRaw != null) return `${open}>${n.innerRaw.trim()}</${n.name}>`;
  const ind2 = ind + '  ';
  const inner = n.children.map(c => ind2 + (c.type === 'el' ? printEl(c, ind2) : c.type === 'expr' ? `{${collapse(c.raw)}}` : c.value)).join('\n');
  return `${open}>\n${inner}\n${ind}</${n.name}>`;
}

// Alle Komponentennamen, die im Baum oder in Ausdrücken als JSX vorkommen.
export function usedNames(root) {
  const names = new Set();
  const scan = raw => { for (const m of raw.matchAll(/<([A-Z][\w$]*)/g)) names.add(m[1]); };
  walk(root, n => {
    names.add(n.name.split('.')[0]);
    n.attrs.forEach(a => { if (a.raw && a.kind !== 'str') scan(a.raw); });
    n.children.forEach(c => { if (c.type === 'expr') scan(c.raw); });
  });
  return names;
}

// Hält die Import-Zeile des Design Systems synchron mit den genutzten Komponenten.
export function syncImports(text, root, pkg, known) {
  const used = [...usedNames(root)].filter(n => known.has(n));
  const re = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*['"]${pkg.replace(/[/@.-]/g, m => '\\' + m)}['"];?`);
  const m = re.exec(text);
  const body = m ? text.slice(0, m.index) + text.slice(m.index + m[0].length) : text;
  const existing = m ? m[1].split(',').map(x => x.trim()).filter(Boolean) : [];
  const keep = existing.filter(n => used.includes(n) || new RegExp(`\\b${n}\\b`).test(body));
  const all = keep.concat(used.filter(n => !keep.includes(n)));
  if (!all.length) return m ? body.replace(/^\n/, '') : text;
  const line = `import { ${all.join(', ')} } from '${pkg}';`;
  return m ? text.slice(0, m.index) + line + text.slice(m.index + m[0].length) : `${line}\n${text}`;
}

export function printModule(mod, opts = {}) {
  let out = mod.prefix + printEl(mod.root, mod.baseInd) + mod.suffix;
  if (opts.pkg && opts.known) out = syncImports(out, mod.root, opts.pkg, opts.known);
  return out;
}

// ---------- Baum-Werkzeuge ----------
export function walk(n, fn, parent = null) {
  fn(n, parent);
  for (const c of n.children || []) if (c.type === 'el') walk(c, fn, n);
}

export function getAttr(n, k) {
  const a = n.attrs.find(x => x.name === k);
  if (!a) return undefined;
  if (a.kind === 'bool') return true;
  return a.raw;
}

export function attrValue(a) {
  if (!a) return undefined;
  if (a.kind === 'bool') return true;
  if (a.kind === 'str') return a.raw;
  try { return JSON.parse(a.raw); } catch { return { expr: a.raw }; }
}

export function findById(root, id) {
  let hit = null;
  walk(root, (n, p) => { if (!hit && getAttr(n, 'data-wf') === id) hit = { node: n, parent: p }; });
  return hit;
}

export function ensureIds(root) {
  const used = new Set();
  walk(root, n => { const id = getAttr(n, 'data-wf'); if (id) used.add(id); });
  walk(root, n => {
    if (getAttr(n, 'data-wf')) return;
    const base = n.name.replace(/[^A-Za-z0-9]/g, '').toLowerCase() || 'el';
    let k = 1;
    while (used.has(`${base}_${k}`)) k++;
    used.add(`${base}_${k}`);
    n.attrs.unshift({ name: 'data-wf', kind: 'str', raw: `${base}_${k}`, quote: '"' });
  });
  return root;
}

export function setProp(n, name, value) {
  const i = n.attrs.findIndex(a => a.name === name);
  if (value === undefined || value === null || value === false && name !== 'value') {
    if (i >= 0) n.attrs.splice(i, 1);
    return n;
  }
  let a;
  if (value === true) a = { name, kind: 'bool' };
  else if (typeof value === 'string' && !/["{}]/.test(value)) a = { name, kind: 'str', raw: value, quote: '"' };
  else if (value && typeof value === 'object' && 'expr' in value) a = { name, kind: 'expr', raw: String(value.expr) };
  else a = { name, kind: 'expr', raw: JSON.stringify(value) };
  if (i >= 0) n.attrs[i] = a; else n.attrs.push(a);
  return n;
}

export function setText(n, text) {
  const safe = /[{}<>]/.test(text) ? `{${JSON.stringify(text)}}` : text;
  n.children = text ? [{ type: 'text', value: text }] : [];
  n.inline = true;
  n.innerRaw = safe;
  return n;
}

export function textOf(n) {
  return n.children.filter(c => c.type === 'text').map(c => c.value).join(' ');
}

export function makeEl(name, props = {}, text = '') {
  const n = { type: 'el', name, attrs: [], children: [], inline: true, innerRaw: null };
  for (const [k, v] of Object.entries(props)) setProp(n, k, v);
  if (text) setText(n, text);
  return n;
}

const elKids = p => p.children.filter(c => c.type === 'el');

// Fügt ein Element als index-tes Element-Kind (Text/Ausdrücke zählen nicht) ein.
export function insertEl(parent, index, el) {
  const kids = elKids(parent);
  parent.inline = false;
  parent.innerRaw = null;
  if (index >= kids.length) parent.children.push(el);
  else parent.children.splice(parent.children.indexOf(kids[Math.max(0, index)]), 0, el);
  return el;
}

export function removeEl(root, id) {
  const hit = findById(root, id);
  if (!hit || !hit.parent) return null;
  hit.parent.children.splice(hit.parent.children.indexOf(hit.node), 1);
  return hit.node;
}

export function moveEl(root, id, parentId, index) {
  const hit = findById(root, id);
  if (!hit || !hit.parent) return false;
  const target = parentId ? findById(root, parentId)?.node : hit.parent;
  if (!target) return false;
  let inside = false;
  walk(hit.node, n => { if (n === target) inside = true; });
  if (inside) return false;
  hit.parent.children.splice(hit.parent.children.indexOf(hit.node), 1);
  insertEl(target, index, hit.node);
  return true;
}

export function indexInParent(root, id) {
  const hit = findById(root, id);
  if (!hit || !hit.parent) return -1;
  return elKids(hit.parent).indexOf(hit.node);
}

export function cloneEl(n) { return JSON.parse(JSON.stringify(n)); }

export function stripIds(n) {
  n.attrs = n.attrs.filter(a => a.name !== 'data-wf');
  n.children.forEach(c => { if (c.type === 'el') stripIds(c); });
  return n;
}
