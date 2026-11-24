// Läuft in jedem Storybook-Frame des Canvas (der Canvas fügt es in iframe.html ein).
// Meldet den React-Komponentenbaum der Story mit Lage und Größe, die Args der Story
// und Fehler an den Canvas – und setzt Args auf Wunsch live (wie die Controls).
(() => {
  if (window.parent === window || window.__wfSb) return;
  const storyId = new URLSearchParams(location.search).get('id') || '';
  const post = msg => {
    try { window.parent.postMessage({ wf: 1, sb: 1, story: storyId, ...msg }, location.origin); } catch { /* Canvas weg */ }
  };

  // React-Fiber-Tags: Funktion 0, Klasse 1, forwardRef 11, memo 14/15; Host 5 (Element), 6 (Text).
  const COMP = new Set([0, 1, 11, 14, 15]);
  const SKIP = /^(ErrorBoundary|StrictMode|Suspense|Fragment|Profiler|Unknown|Anonymous|Story|StoryFn|storyFn|unboundStoryFn|boundStoryFunction|hookified|decorateStory|render|Render|Wrapper|DecoratorWrapper|_.*|.*Provider|.*Context|.*Consumer)$/;

  function nameOf(f) {
    const t = f.type;
    if (!t) return null;
    if (typeof t === 'function') return t.displayName || t.name || null;
    if (typeof t === 'object') {
      const inner = t.render || t.type;
      return t.displayName || (inner && (inner.displayName || inner.name)) || null;
    }
    return null;
  }
  function rootFiber() {
    const el = document.getElementById('storybook-root') || document.getElementById('root');
    if (!el) return null;
    const key = Object.keys(el).find(k => k.startsWith('__reactContainer$'));
    const f = key && el[key];
    return f ? (f.stateNode && f.stateNode.current) || f : null;
  }
  function hostNodes(f, acc = []) {
    for (let c = f.child; c; c = c.sibling) {
      if (c.tag === 5 || c.tag === 6) acc.push(c.stateNode);
      else hostNodes(c, acc);
    }
    return acc;
  }
  function rectOf(nodes) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const n of nodes) {
      let r = null;
      if (n.nodeType === 1) r = n.getBoundingClientRect();
      else if (n.nodeType === 3 && n.textContent.trim()) { const rg = document.createRange(); rg.selectNodeContents(n); r = rg.getBoundingClientRect(); }
      if (!r || (!r.width && !r.height)) continue;
      x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top); x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom);
    }
    return x1 === Infinity ? null : [Math.round(x1 + scrollX), Math.round(y1 + scrollY), Math.round(x2 - x1), Math.round(y2 - y1)];
  }
  function val(v, depth = 0) {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    if (typeof v === 'string') return JSON.stringify(v.length > 80 ? `${v.slice(0, 77)}…` : v);
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (typeof v === 'function') return 'ƒ';
    if (v.$$typeof) return `‹${(v.type && (typeof v.type === 'string' ? v.type : v.type.displayName || v.type.name)) || 'Element'}›`;
    if (Array.isArray(v)) return depth ? `[${v.length}]` : `[${v.slice(0, 4).map(x => val(x, 1)).join(', ')}${v.length > 4 ? ', …' : ''}]`;
    if (typeof v === 'object') { const k = Object.keys(v); return depth ? '{…}' : `{${k.slice(0, 4).join(', ')}${k.length > 4 ? ', …' : ''}}`; }
    return String(v);
  }
  // Sichtbarer Text, mit Leerzeichen zwischen den Elementen (textContent klebt sie zusammen).
  function textOf(nodes) {
    const parts = [];
    let len = 0;
    for (const n of nodes) {
      if (n.nodeType === 3) { const t = n.textContent.trim(); if (t) { parts.push(t); len += t.length; } continue; }
      if (n.nodeType !== 1) continue;
      const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
      for (let t = w.nextNode(); t && len < 80; t = w.nextNode()) {
        const s = t.textContent.trim();
        if (s && !(t.parentElement && /^(SCRIPT|STYLE)$/.test(t.parentElement.tagName))) { parts.push(s); len += s.length; }
      }
      if (len >= 80) break;
    }
    return parts.join(' ').replace(/\s+/g, ' ').slice(0, 80);
  }
  function propsOf(f) {
    const p = f.memoizedProps || {};
    return Object.keys(p).filter(k => k !== 'children' || typeof p.children === 'string' || typeof p.children === 'number').slice(0, 30).map(k => ({ name: k, raw: val(p[k]) }));
  }
  // Wo das Element entstanden ist (JSX-Aufruf im Code des Besitzers) – aus React 19 (_debugStack)
  // oder älter (_debugSource). Bibliotheken und Storybook selbst bleiben außen vor.
  function srcOf(f) {
    if (f._debugSource && f._debugSource.fileName) return String(f._debugSource.fileName);
    const stack = f._debugStack && f._debugStack.stack;
    if (!stack) return null;
    for (const line of String(stack).split('\n').slice(1)) {
      const m = /(https?:\/\/[^\s)]+?):\d+:\d+/.exec(line);
      if (!m) continue;
      let p;
      try { p = new URL(m[1]).pathname; } catch { continue; }
      if (/\/node_modules\/|^\/@(vite|id|react-refresh)|^\/sb-|^\/\.storybook\//.test(p)) continue;
      return decodeURIComponent(p.startsWith('/@fs/') ? p.slice(4) : p.slice(1));
    }
    return null;
  }

  let built = { tree: [], list: [] };
  function build() {
    const list = [];
    const tree = [];
    const visit = (fiber, parentId, out, counts) => {
      for (let f = fiber; f; f = f.sibling) {
        const name = COMP.has(f.tag) ? nameOf(f) : null;
        if (name && !SKIP.test(name)) {
          const n = counts.get(name) || 0;
          counts.set(name, n + 1);
          const id = parentId ? `${parentId}/${name}.${n}` : `${name}.${n}`;
          const node = { id, name, text: '', props: [], src: null, children: [] };
          out.push(node);
          list.push({ id, fiber: f, node });
          visit(f.child, id, node.children, new Map());
        } else {
          visit(f.child, parentId, out, counts);
        }
      }
    };
    const r = rootFiber();
    if (r) visit(r.child, '', tree, new Map());
    return { tree, list };
  }

  // Args der Story (über die Preview-API von Storybook, wie das Controls-Panel).
  function plain(v, depth = 0) {
    if (v === null || typeof v === 'boolean' || typeof v === 'number') return v;
    if (typeof v === 'string') return v.length > 4000 ? v.slice(0, 4000) : v;
    if (typeof v === 'function' || v === undefined || typeof v === 'symbol' || typeof v === 'bigint') return undefined;
    if (v.$$typeof) return { $wf: 'element', name: (v.type && (typeof v.type === 'string' ? v.type : v.type.displayName || v.type.name)) || 'Element' };
    if (depth > 5) return undefined;
    if (Array.isArray(v)) return v.slice(0, 100).map(x => plain(x, depth + 1));
    if (v instanceof Date) return v.toISOString();
    const out = {};
    for (const k of Object.keys(v).slice(0, 100)) { const x = plain(v[k], depth + 1); if (x !== undefined) out[k] = x; }
    return out;
  }
  function argTypesOf(at) {
    const out = {};
    for (const [k, a] of Object.entries(at || {})) {
      if (!a || (a.table && a.table.disable) || a.control === false) continue;
      const t = a.type || {};
      const control = typeof a.control === 'string' ? a.control : (a.control && a.control.type) || null;
      let options = a.options || (t.name === 'enum' ? t.value : null);
      if (!options && t.name === 'union' && Array.isArray(t.value) && t.value.every(x => x && x.name === 'literal')) options = t.value.map(x => String(x.value).replace(/^['"]|['"]$/g, ''));
      out[k] = {
        control,
        type: t.name || null,
        options: Array.isArray(options) ? options.slice(0, 40).map(String) : null,
        required: !!t.required,
        action: !!a.action || (t.name === 'function' && /^on[A-Z]/.test(k)),
        description: String(a.description || '').slice(0, 240),
      };
    }
    return out;
  }
  let info = null;
  async function loadInfo() {
    // Nur storyStoreValue: der alte Getter storyStore meldet Fehler, solange der Index lädt.
    const p = window.__STORYBOOK_PREVIEW__;
    const store = p && p.storyStoreValue;
    if (!store || !store.loadStory) return false;
    try {
      const s = await store.loadStory({ storyId });
      const args = (store.args && store.args.get && store.args.get(storyId)) || s.initialArgs || {};
      info = {
        title: s.title,
        name: s.name,
        layout: (s.parameters && s.parameters.layout) || 'padded',
        fileName: (s.parameters && s.parameters.fileName) || null,
        argTypes: argTypesOf(s.argTypes),
        initialArgs: plain(s.initialArgs || {}),
        args: plain(args),
      };
      post({ type: 'story', info });
      return true;
    } catch {
      return false;
    }
  }

  let failed = false;
  let hooked = false;
  function hookChannel() {
    const ch = window.__STORYBOOK_ADDONS_CHANNEL__;
    if (!ch || !ch.on) return false;
    ch.on('storyArgsUpdated', d => {
      if (!d || d.storyId !== storyId) return;
      const args = plain(d.args || {});
      if (info) info.args = args;
      post({ type: 'args', args });
    });
    ch.on('storyRendered', id => { if (!id || id === storyId) { failed = false; report(); } });
    const fail = e => {
      failed = true;
      post({ type: 'error', message: String((e && (e.description || e.message || e.title)) || e || 'Fehler in der Story') });
      report();
    };
    ch.on('storyErrored', fail);
    ch.on('storyThrewException', fail);
    ch.on('storyMissing', () => fail('Story nicht gefunden'));
    return true;
  }

  let timer = 0;
  let sent = false;
  function report() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      built = build();
      const boxes = {};
      for (const it of built.list) {
        const nodes = hostNodes(it.fiber);
        const r = rectOf(nodes);
        if (r) boxes[it.id] = r;
        it.node.text = textOf(nodes);
        it.node.props = propsOf(it.fiber);
        it.node.src = srcOf(it.fiber);
      }
      const root = document.getElementById('storybook-root') || document.getElementById('root');
      const rr = root && root.getBoundingClientRect();
      const height = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
      const cls = document.body ? document.body.classList : { contains: () => false };
      const errorShown = cls.contains('sb-show-errordisplay');
      // Inhaltshöhe für Komponenten-Stories: Höhe der Story plus Rand des Layouts (padded/centered).
      const content = rr ? Math.ceil(rr.height) + (cls.contains('sb-main-fullscreen') ? 0 : 32) : 0;
      post({ type: sent ? 'layout' : 'ready', boxes, tree: built.tree, height, content, failed: failed || errorShown });
      sent = true;
    }, sent ? 60 : 30);
  }

  window.__wfSb = {
    // Erstes DOM-Element einer Komponente – für den Style-Reiter (gleicher Ursprung).
    node(id) {
      const it = built.list.find(x => x.id === id);
      return it ? hostNodes(it.fiber).find(n => n.nodeType === 1) || null : null;
    },
    info: () => info,
  };

  addEventListener('message', e => {
    if (e.origin !== location.origin || e.source !== window.parent || !e.data || e.data.wf !== 1) return;
    const ch = window.__STORYBOOK_ADDONS_CHANNEL__;
    if (e.data.type === 'sbArgs' && ch) ch.emit('updateStoryArgs', { storyId, updatedArgs: e.data.args || {} });
    if (e.data.type === 'sbReset' && ch) ch.emit('resetStoryArgs', { storyId, argNames: e.data.names });
    if (e.data.type === 'sbInfo') loadInfo();
  });
  addEventListener('error', e => post({ type: 'error', message: String(e.message || e.error) }));

  const start = () => {
    new MutationObserver(report).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    report();
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
  addEventListener('load', report);
  addEventListener('resize', report);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(report);
  let tries = 0;
  const wait = setInterval(() => {
    if (!hooked) hooked = hookChannel();
    if (hooked && !info) loadInfo();
    if ((hooked && info) || ++tries > 150) clearInterval(wait);
  }, 100);
})();
