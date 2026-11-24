// Flows: Integrität und Export.
import { findById } from './jsx.js';

export function flowIssues(flow, model) {
  const issues = [];
  const add = (level, code, message, ref) => issues.push({ level, code, message, ref });
  const nodes = new Map((flow.nodes || []).map(n => [n.id, n]));
  const edges = flow.edges || [];
  for (const n of nodes.values()) {
    if (n.type === 'screen') {
      const s = model.screens[n.ref];
      if (!s || s.error) add('error', 'screen', `${n.title || n.id}: ${s?.error || 'Screen-Modul fehlt'}`, n.id);
    }
    if (n.type === 'decision') {
      const outs = edges.filter(e => e.from === n.id);
      if (!outs.some(e => e.when && e.when !== 'else')) add('warning', 'decision-yes', `„${n.label}“ hat keinen Ja-Pfad.`, n.id);
      if (!outs.some(e => e.when === 'else')) add('warning', 'decision-no', `„${n.label}“ hat keinen Nein-Pfad.`, n.id);
    }
  }
  for (const e of edges) {
    if (!nodes.has(e.from)) add('error', 'edge', `Verbindung von unbekanntem Knoten ${e.from}`, e.from);
    if (!nodes.has(e.to)) add('error', 'edge', `Verbindung zu unbekanntem Knoten ${e.to}`, e.from);
    if (e.el && nodes.get(e.from)?.type === 'screen') {
      const s = model.screens[nodes.get(e.from).ref];
      if (s?.tree && !findById(s.tree, e.el)) add('error', 'hotspot', `${nodes.get(e.from).title || e.from}: Element ${e.el} für „${e.label || e.to}“ fehlt im Code.`, e.from);
    }
  }
  if (flow.entry && nodes.has(flow.entry)) {
    const seen = new Set([flow.entry]);
    const queue = [flow.entry];
    while (queue.length) {
      const id = queue.shift();
      for (const e of edges) if (e.from === id && !seen.has(e.to)) { seen.add(e.to); queue.push(e.to); }
    }
    for (const n of nodes.values()) if (!seen.has(n.id)) add('warning', 'unreachable', `${n.title || n.label || n.id} ist vom Einstieg aus nicht erreichbar.`, n.id);
  } else add('error', 'entry', 'Der Flow hat keinen gültigen Einstieg (entry).');
  for (const n of nodes.values()) {
    if (n.type === 'screen' && !n.exit && !edges.some(e => e.from === n.id)) add('info', 'dead-end', `${n.title || n.id} hat keinen Ausgang – als Ausstieg markieren (exit) oder verbinden.`, n.id);
  }
  return issues;
}

export function toMermaid(flow, model) {
  const L = ['flowchart LR'];
  const label = n => (n.title || n.label || n.id).replace(/"/g, "'");
  for (const n of flow.nodes || []) L.push(n.type === 'decision' ? `  ${n.id}{"${label(n)}"}` : `  ${n.id}["${label(n)}"]`);
  for (const e of flow.edges || []) L.push(`  ${e.from} -->${e.label ? `|${e.label.replace(/\|/g, '/')}|` : ''} ${e.to}`);
  return L.join('\n');
}
