// User Journey als Story Map (wireflow/journey@2).
// Phasen (Aktivitäten) → Schritte → Pain Points → Bedarfe → Anforderungen → Screens.
// Bis zu den Bedarfen ohne Lösung; erst Anforderungen verweisen auf Screens (Knoten-IDs im Flow).
// Journeys im alten Format (@1: actions[] und painPoints[] je Phase) werden beim Laden übersetzt.

export const JOURNEY_SCHEMA = 'wireflow/journey@2';

// Begriffe, die eine Lösung statt eines Ziels beschreiben – nur Hinweise, keine Fehler.
export const SOLUTION_TERMS = [
  [/tipp/i, 'tippen', 'wählen, sich entscheiden'],
  [/klick/i, 'klicken', 'wählen, bestätigen'],
  [/button|knopf/i, 'Button', 'das Ziel dahinter'],
  [/screen|bildschirm|\bseite\b|maske/i, 'Screen', 'was dort erreicht wird'],
  [/formular|feld\b|felder/i, 'Feld', 'was angegeben wird'],
  [/dropdown|menü|popup|\bliste\b|filter/i, 'Bauteil', 'was gefunden oder entschieden wird'],
  [/eingeben|ausfüllen/i, 'eingeben', 'angeben, mitteilen'],
  [/\bslot/i, 'Slot', 'Termin, Zeit'],
  [/log ?in|anmelden|registrier/i, 'Login', 'sich ausweisen, nur wenn nötig'],
  [/\bapp\b|website|portal/i, 'App', 'offen lassen, wo es passiert'],
];
export function solutionTerm(text) {
  for (const [re, word, better] of SOLUTION_TERMS) if (re.test(text || '')) return { word, better };
  return null;
}

// Art eines Bedarfs aus dem ersten passenden Verb – Hilfe, keine Pflicht.
export const NEED_TYPES = [
  ['info', 'Information', /\b(wissen|erkennen|verstehen|sehen|erfahren|nachvollziehen)\b/i],
  ['ent', 'Entscheidung', /\b(vergleichen|auswählen|wählen|entscheiden|abwägen|einschätzen)\b/i],
  ['hand', 'Handlung', /\b(angeben|ändern|korrigieren|erledigen|absagen|verschieben|mitteilen|bezahlen)\b/i],
];
export function needType(text) {
  let best = null;
  let pos = Infinity;
  for (const [k, , re] of NEED_TYPES) {
    const m = (text || '').match(re);
    if (m && m.index < pos) { pos = m.index; best = k; }
  }
  return best;
}

const str = v => (typeof v === 'string' ? v : v == null ? '' : String(v));
const arr = v => (Array.isArray(v) ? v : []);

function normPain(p, id) {
  if (typeof p === 'string') return { id, text: p };
  const out = { ...p, id: p.id || id, text: str(p.text) };
  if (!out.insight) delete out.insight;
  return out;
}
function normReq(r, id) {
  if (typeof r === 'string') return { id, text: r, screens: [] };
  const out = { ...r, id: r.id || id, text: str(r.text), screens: arr(r.screens).map(str) };
  if (!out.partial) delete out.partial;
  return out;
}
function normNeed(n, id) {
  if (typeof n === 'string') return { id, text: n, solves: [], requirements: [] };
  const out = { ...n, id: n.id || id, text: str(n.text), solves: arr(n.solves).map(str), requirements: arr(n.requirements).map((r, i) => normReq(r, `${n.id || id}_a${i + 1}`)) };
  if (!out.insight) delete out.insight;
  delete out.type;
  return out;
}
function normStep(s, id) {
  if (typeof s === 'string') return { id, text: s, painPoints: [], needs: [] };
  const sid = s.id || id;
  return { ...s, id: sid, text: str(s.text), painPoints: arr(s.painPoints).map((p, i) => normPain(p, `${sid}_p${i + 1}`)), needs: arr(s.needs).map((n, i) => normNeed(n, `${sid}_b${i + 1}`)) };
}

/** Übersetzt eine Journey (@1 oder @2) in das Story-Map-Format @2. Stabile IDs, damit Verweise halten. */
export function normalizeJourney(j) {
  const { file, ...rest } = j || {};
  const phases = arr(rest.phases).map((ph, pi) => {
    const pid = ph.id || `ph_${pi + 1}`;
    const { actions, painPoints, steps, ...keep } = ph;
    let st = arr(steps).map((s, i) => normStep(s, `${pid}_s${i + 1}`));
    if (!steps) {
      st = arr(actions).map((a, i) => normStep(a, `${pid}_s${i + 1}`));
      const pains = arr(painPoints).map((p, i) => normPain(p, `${pid}_p${i + 1}`));
      if (pains.length) {
        if (!st.length) st.push(normStep(keep.title || 'Schritt', `${pid}_s1`));
        st[0].painPoints.push(...pains);
      }
    }
    return { ...keep, id: pid, title: str(keep.title), steps: st };
  });
  const out = { ...rest, schema: JOURNEY_SCHEMA, id: str(rest.id), title: str(rest.title), phases };
  if (file) out.file = file;
  return out;
}

/** Prüft die Struktur; wirft bei Fehlern, die das Speichern verhindern sollen. */
export function validateJourney(j) {
  if (!j?.id) throw new Error('Journey braucht eine id');
  if (!Array.isArray(j.phases)) throw new Error('Journey braucht phases[]');
  const ids = new Set();
  const seen = id => {
    if (!id) throw new Error('Jedes Element braucht eine id');
    if (ids.has(id)) throw new Error(`Doppelte id in der Journey: ${id}`);
    ids.add(id);
  };
  const pains = new Set();
  for (const ph of j.phases) {
    seen(ph.id);
    for (const s of ph.steps) {
      seen(s.id);
      for (const p of s.painPoints) { seen(p.id); pains.add(p.id); }
      for (const n of s.needs) { seen(n.id); for (const r of n.requirements) seen(r.id); }
    }
  }
  for (const ph of j.phases) for (const s of ph.steps) for (const n of s.needs) {
    const bad = n.solves.filter(x => !pains.has(x));
    if (bad.length) throw new Error(`Bedarf ${n.id} verweist auf unbekannte Pain Points: ${bad.join(', ')}`);
  }
  return true;
}

/** Offene Punkte der Story Map – für Canvas und Claude gleich. */
export function journeyGaps(j, model) {
  const insights = new Map((model?.knowledge?.insights || []).map(i => [i.id, i]));
  const nodes = new Set((model?.flows || []).flatMap(f => (f.nodes || []).map(n => n.id)));
  const out = [];
  const solvedBy = new Map();
  for (const ph of j.phases) for (const s of ph.steps) for (const n of s.needs) for (const p of n.solves) solvedBy.set(p, (solvedBy.get(p) || 0) + 1);
  for (const ph of j.phases) for (const s of ph.steps) {
    const at = `${ph.title} › ${s.text}`;
    const term = solutionTerm(s.text);
    if (term) out.push({ id: s.id, at, art: 'loesung', text: `Schritt klingt nach Lösung („${term.word}“) – besser: ${term.better}` });
    if (!s.needs.length) out.push({ id: s.id, at, art: 'bedarf', text: 'Schritt hat noch keine Bedarfe' });
    for (const p of s.painPoints) {
      if (!solvedBy.get(p.id)) out.push({ id: p.id, at, art: 'pain', text: `Pain Point „${p.text}“ hat noch keinen Bedarf` });
      if (p.insight && !insights.has(p.insight)) out.push({ id: p.id, at, art: 'beleg', text: `Pain Point verweist auf unbekannten Insight ${p.insight}` });
    }
    s.needs.forEach((n, i) => {
      const lab = `${at} › B${i + 1}`;
      const nt = solutionTerm(n.text);
      if (nt) out.push({ id: n.id, at: lab, art: 'loesung', text: `Bedarf klingt nach Lösung („${nt.word}“) – besser: ${nt.better}` });
      if (!n.insight) out.push({ id: n.id, at: lab, art: 'annahme', text: 'Bedarf ohne Beleg (Annahme)' });
      else if (!insights.has(n.insight)) out.push({ id: n.id, at: lab, art: 'beleg', text: `Bedarf verweist auf unbekannten Insight ${n.insight}` });
      if (!n.requirements.length) out.push({ id: n.id, at: lab, art: 'anforderung', text: 'Bedarf hat noch keine Anforderung' });
      for (const r of n.requirements) {
        if (!r.screens.length) out.push({ id: r.id, at: lab, art: 'screen', text: `Anforderung „${r.text}“ hat keinen Screen` });
        else if (r.partial) out.push({ id: r.id, at: lab, art: 'teilweise', text: `Anforderung nur teilweise gelöst: ${r.partial}` });
        const unknown = r.screens.filter(x => nodes.size && !nodes.has(x));
        if (unknown.length) out.push({ id: r.id, at: lab, art: 'screen', text: `Anforderung verweist auf unbekannte Screens: ${unknown.join(', ')}` });
      }
    });
  }
  return out;
}
