// Strukturierte Änderungen an Flows – Knoten verschieben, verbinden, Screens anlegen.
import path from 'node:path';
import { writeJson, flowById, removeTracked } from './project.js';
import { wireTrigger, newScreen, slugify } from './screens.js';

const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

export function applyFlowOp(model, flowId, op) {
  const f = flowById(model, flowId);
  if (!f) throw new Error(`Flow ${flowId || ''} nicht gefunden`);
  const { file, ...data } = structuredClone(f);
  data.nodes ||= [];
  data.edges ||= [];
  const { nodes, edges } = data;
  const node = id => nodes.find(n => n.id === id) || (() => { throw new Error(`Knoten ${id} nicht gefunden`); })();
  const uniqueId = base => {
    let id = base;
    let k = 1;
    while (nodes.some(n => n.id === id)) id = `${base}_${++k}`;
    return id;
  };
  const out = { flow: data.id };
  switch (op.op) {
    case 'moveNode': {
      const n = node(op.id);
      n.x = Math.round(op.x);
      n.y = Math.round(op.y);
      break;
    }
    case 'setNode': {
      const n = node(op.id);
      for (const [k, v] of Object.entries(op.props || {})) {
        if (!['title', 'label', 'var', 'story', 'exit'].includes(k)) continue;
        if (v === null || v === '' || v === false) delete n[k];
        else n[k] = v;
      }
      if (n.type === 'decision' && n.var && !(n.var in (data.variables ||= {}))) data.variables[n.var] = false;
      break;
    }
    case 'connect': {
      const from = node(op.from);
      node(op.to);
      if (op.from === op.to) throw new Error('Ein Knoten kann nicht mit sich selbst verbunden werden');
      const same = edges.find(e => e.from === op.from && (e.el || null) === (op.el || null) && (e.when || null) === (op.when || null));
      if (same) {
        same.to = op.to;
        if (op.label) same.label = op.label;
        delete same.route;
      } else {
        edges.push(clean({ from: op.from, el: op.el, to: op.to, label: op.label, when: op.when }));
      }
      if (op.el && from.type === 'screen') Object.assign(out, wireTrigger(model, from.ref, op.el));
      break;
    }
    case 'updateEdge': {
      const e = edges[op.index];
      if (!e) throw new Error('Verbindung nicht gefunden');
      for (const k of ['label', 'when', 'to']) {
        if (!(k in (op.props || {}))) continue;
        const v = op.props[k];
        if (v === null || v === '') delete e[k];
        else e[k] = v;
      }
      if ('to' in (op.props || {})) delete e.route;
      break;
    }
    case 'disconnect':
      if (!edges[op.index]) throw new Error('Verbindung nicht gefunden');
      edges.splice(op.index, 1);
      break;
    case 'addScreen': {
      const s = op.ref ? { ref: op.ref } : newScreen(model, { title: op.title, flowTitle: data.title });
      const id = uniqueId(`scr_${slugify(op.title || path.basename(s.ref, '.screen.tsx')).replace(/-/g, '_')}`);
      nodes.push(clean({ id, type: 'screen', title: op.title || id, ref: s.ref, x: Math.round(op.x ?? 0), y: Math.round(op.y ?? 0) }));
      if (!data.entry) data.entry = id;
      out.node = id;
      out.ref = s.ref;
      break;
    }
    case 'addDecision': {
      const id = uniqueId(`dec_${slugify(op.label || 'entscheidung').replace(/-/g, '_')}`);
      const v = op.var || slugify(op.label || 'bedingung').replace(/-(\w)/g, (_, c) => c.toUpperCase());
      nodes.push({ id, type: 'decision', label: op.label || 'Bedingung?', var: v, x: Math.round(op.x ?? 0), y: Math.round(op.y ?? 0) });
      data.variables ||= {};
      if (!(v in data.variables)) data.variables[v] = false;
      out.node = id;
      break;
    }
    case 'removeNode': {
      node(op.id);
      data.nodes = nodes.filter(n => n.id !== op.id);
      data.edges = edges.filter(e => e.from !== op.id && e.to !== op.id);
      if (data.entry === op.id) data.entry = data.nodes[0]?.id;
      break;
    }
    case 'setEntry':
      node(op.id);
      data.entry = op.id;
      break;
    case 'addVariant': {
      const n = node(op.id);
      if (n.type !== 'screen') throw new Error('Varianten gibt es nur für Screens');
      n.variants ||= [];
      if (!n.variants.some(v => v.ref === op.ref)) n.variants.push(clean({ ref: op.ref, mode: op.mode, label: op.label, rationale: op.rationale, by: op.by }));
      out.ref = op.ref;
      break;
    }
    case 'promoteVariant': {
      // Tauschen: Die Variante wird zum Screen im Flow, das Original bleibt als Variante erhalten.
      const n = node(op.id);
      const v = (n.variants || []).find(x => x.ref === op.ref);
      if (!v) throw new Error('Variante nicht gefunden');
      const before = n.ref;
      n.ref = v.ref;
      n.variants = n.variants.map(x => (x === v ? { ref: before, mode: 'original', label: 'Vorherige Fassung' } : x));
      out.ref = n.ref;
      break;
    }
    case 'discardVariant': {
      const n = node(op.id);
      const list = n.variants || [];
      if (!list.some(x => x.ref === op.ref)) throw new Error('Variante nicht gefunden');
      n.variants = list.filter(x => x.ref !== op.ref);
      if (!n.variants.length) delete n.variants;
      // Noch irgendwo in Gebrauch? (dieser Flow im neuen Stand, andere Flows wie geladen)
      const used = [data, ...model.flows.filter(fl => fl.id !== data.id)]
        .some(fl => (fl.nodes || []).some(x => x.ref === op.ref || (x.variants || []).some(v => v.ref === op.ref)));
      if (!used && op.keepFile !== true) {
        const file = path.join(model.wf, op.ref);
        removeTracked(file);
        removeTracked(file.replace(/\.screen\.tsx$/, '.stories.tsx'));
        out.removed = op.ref;
      }
      break;
    }
    case 'setFlow': {
      const title = String(op.title || '').trim();
      if (!title) throw new Error('Titel fehlt');
      data.title = title.slice(0, 120);
      break;
    }
    case 'setVariable':
      if (!op.name) throw new Error('Variablenname fehlt');
      data.variables ||= {};
      if (op.value === undefined) delete data.variables[op.name];
      else data.variables[op.name] = op.value;
      break;
    default:
      throw new Error(`Unbekannte Flow-Operation: ${op.op}`);
  }
  writeJson(path.join(model.wf, file), data);
  return out;
}

/** Legt einen leeren Flow an – im Canvas eine neue Seite. */
export function createFlow(model, title = 'Neue Seite') {
  const name = String(title).trim().slice(0, 120) || 'Neue Seite';
  const base = `flw_${slugify(name).replace(/-/g, '_') || 'seite'}`;
  let id = base;
  for (let k = 2; model.flows.some(f => f.id === id); k++) id = `${base}_${k}`;
  let file = `flows/${slugify(name) || 'seite'}.flow.json`;
  for (let k = 2; model.flows.some(f => f.file === file); k++) file = `flows/${slugify(name) || 'seite'}-${k}.flow.json`;
  writeJson(path.join(model.wf, file), { schema: 'wireflow/flow@1', id, title: name, entry: null, variables: {}, nodes: [], edges: [] });
  return { flow: id, file };
}
