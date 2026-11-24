// Wissensbasis: Wissensstand von Flow-Elementen (belegt, Hinweis, Annahme, offen, Widerspruch).
export const LEVELS = ['widerspruch', 'offen', 'annahme', 'hinweis', 'belegt'];

export function grounding(basis, knowledge) {
  const ins = (basis?.insights || []).map(id => knowledge.insights.find(i => i.id === id)).filter(Boolean);
  const ass = (basis?.assumptions || []).map(id => knowledge.assumptions.find(a => a.id === id)).filter(Boolean);
  const refs = [...ins.map(i => ({ kind: 'insight', id: i.id, text: i.aussage, level: i.wissensstand })), ...ass.map(a => ({ kind: 'assumption', id: a.id, text: a.aussage, status: a.status }))];
  let level = 'offen';
  if (ass.some(a => a.status === 'widerlegt') || ins.some(i => i.wissensstand === 'widerspruch')) level = 'widerspruch';
  else if (ins.some(i => i.wissensstand === 'belegt') || ass.some(a => a.status === 'bestätigt')) level = 'belegt';
  else if (ins.some(i => i.wissensstand === 'hinweis')) level = 'hinweis';
  else if (ass.length) level = 'annahme';
  return { level, refs };
}

export function flowKnowledge(flow, knowledge) {
  const nodes = Object.fromEntries((flow.nodes || []).map(n => [n.id, grounding(n.basis, knowledge)]));
  const edges = (flow.edges || []).map(e => ({ from: e.from, to: e.to, label: e.label, ...grounding(e.basis, knowledge) }));
  const counts = Object.fromEntries(LEVELS.map(l => [l, 0]));
  Object.values(nodes).forEach(g => { counts[g.level]++; });
  return { nodes, edges, counts };
}

export function openAssumptions(knowledge) {
  const rank = { hoch: 0, mittel: 1, niedrig: 2 };
  return knowledge.assumptions
    .filter(a => a.status !== 'bestätigt' && a.status !== 'widerlegt')
    .sort((a, b) => (rank[a.wichtigkeit] ?? 3) - (rank[b.wichtigkeit] ?? 3) || (a.evidenz === 'keine' ? -1 : 1));
}
