// Tools des wireflow-MCP-Servers – „die Hände“ für Claude.
import fs from 'node:fs';
import path from 'node:path';
import { findRoot, loadProject, readJson, writeJson, undoLast, WF, flowById, loadScreen } from '../core/project.js';
import { components, searchDs, loadTokens } from '../core/ds.js';
import { lintScreen } from '../core/lint.js';
import { flowIssues, toMermaid } from '../core/flow.js';
import { flowKnowledge, openAssumptions } from '../core/knowledge.js';
import { applyOpRecorded, writeScreen, assertScreenRef, slugify } from '../core/screens.js';
import { applyFlowOp } from '../core/flows.js';
import { initProject } from '../core/init.js';
import { walk, getAttr, textOf, findById } from '../core/jsx.js';
import { createBridge } from './bridge.js';
import { journeyGaps } from '../core/journey.js';
import { saveJourney } from '../core/journeys.js';

const rootDir = () => findRoot(process.env.WIREFLOW_ROOT || undefined);
const model = () => loadProject(rootDir());

// ---------- Verbindung zum Canvas-Chat ----------
const ctx = { notify: null, bridge: null };
export function setNotifier(fn) { ctx.notify = fn; }
export function bridgeFor(root = rootDir()) {
  if (!root) throw new Error('Kein Wireflow-Projekt gefunden.');
  if (!ctx.bridge || ctx.bridge.root !== root) ctx.bridge = createBridge({ root, notify: ctx.notify });
  return ctx.bridge;
}
const QUIET = new Set(['canvas_reply', 'canvas_inbox', 'canvas_selection', 'canvas_open', 'project_status']);
const DESCRIBE = {
  screen_edit: a => `Ändert ${a.ref}: ${a.op} ${a.id || a.component || ''}`.trim(),
  screen_write: a => `Schreibt ${a.ref}`,
  screen_get: a => `Liest ${a.ref}`,
  screen_lint: a => `Prüft ${a.ref || 'alle Screens'}`,
  variant_create: a => `Legt Variante „${a.label || a.mode}“ von ${a.ref} an`,
  flow_edit: a => `Flow: ${a.op}${a.title ? ` „${a.title}“` : ''}`,
  flow_upsert: () => 'Schreibt den Flow',
  flow_get: () => 'Liest den Flow',
  flow_validate: () => 'Prüft den Flow',
  ds_search: a => `Sucht im Design System: „${a.query || ''}“`,
  ds_component: a => `Liest Komponente ${a.name}`,
  ds_patterns: a => (a.id ? `Liest Pattern ${a.id}` : 'Liest Patterns'),
  ds_tokens: () => 'Liest Tokens',
  knowledge_get: () => 'Liest die Wissensbasis',
  knowledge_upsert: a => `Wissen: ${a.kind} ${a.item?.id || ''}`.trim(),
  knowledge_status: () => 'Liest den Wissensstand',
  journey_get: () => 'Liest die Journey',
  journey_upsert: () => 'Schreibt die Journey',
  export: a => `Export: ${a.format}`,
  undo: () => 'Macht die letzte Änderung rückgängig',
};
// Meldet Werkzeug-Aufrufe an einen offenen Canvas – dort sieht man, woran Claude arbeitet.
export function activityFor(name, args = {}) {
  if (!ctx.bridge || QUIET.has(name)) return;
  try {
    const ref = typeof args.ref === 'string' && args.ref.startsWith('screens/') ? args.ref : null;
    ctx.bridge.activity({ tool: name, ref, text: (DESCRIBE[name] || (() => name))(args) });
  } catch {
    /* Aktivität ist nur Anzeige */
  }
}
const MODES = { strict: 'Strikt', guided: 'Geführt', free: 'Frei' };
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = description => ({ type: 'string', description });
const slug = s => String(s).toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');

function elements(tree) {
  const out = [];
  walk(tree, (n, p) => out.push({ id: getAttr(n, 'data-wf') || null, component: n.name, parent: p ? getAttr(p, 'data-wf') || null : null, text: textOf(n) || undefined }));
  return out;
}

export function statusOf(m) {
  const screens = Object.values(m.screens).map(s => {
    const l = lintScreen(s, m);
    return { ref: s.ref, component: s.component, dsKonformitaet: `${l.score.pct} %`, fehler: l.errors.length, warnungen: l.warnings.length, stories: s.stories };
  });
  return {
    projekt: m.project.name,
    designSystem: { name: m.manifest.name, paket: m.manifest.package, komponenten: (m.manifest.components || []).length, patterns: m.patterns.map(p => p.id) },
    flows: m.flows.map(f => ({ id: f.id, titel: f.title, knoten: (f.nodes || []).length, befunde: flowIssues(f, m).map(i => `${i.level}: ${i.message}`) })),
    screens,
    wissen: { insights: m.knowledge.insights.length, annahmen: m.knowledge.assumptions.length, offeneFragen: m.knowledge.questions.filter(q => q.status !== 'beantwortet').length, risikoreichsteAnnahmen: openAssumptions(m.knowledge).slice(0, 3).map(a => `${a.id}: ${a.aussage}`) },
  };
}

export const TOOLS = [
  {
    name: 'project_status',
    description: 'Überblick über das Wireflow-Projekt: Design System, Flows mit Befunden, Screens mit DS-Konformität, Wissensstand. Zuerst aufrufen.',
    inputSchema: obj({}),
    run: () => statusOf(model()),
  },
  {
    name: 'project_init',
    description: 'Legt .wireflow/ im Repository an und verknüpft das Design System: Manifest-Entwurf aus den Exporten des Pakets, Token-Dateien, leere Wissensbasis. Bestehende Dateien bleiben unverändert.',
    inputSchema: obj({ dsPackage: str('npm-Paket des Design Systems, z. B. @primer/react oder @acme/ui'), name: str('Projektname') }),
    run: ({ dsPackage, name }) => initProject(path.resolve(process.env.WIREFLOW_ROOT || process.env.CLAUDE_PROJECT_DIR || process.cwd()), { dsPackage, name }),
  },
  {
    name: 'ds_search',
    description: 'Sucht Komponenten und Patterns im verknüpften Design System (nach Name, Intent, Richtlinie). Leere Suche listet alles.',
    inputSchema: obj({ query: str('Suchbegriffe, z. B. „feedback error“ oder „Liste leer“') }),
    run: ({ query = '' }) => searchDs(model(), query),
  },
  {
    name: 'ds_component',
    description: 'Details einer DS-Komponente: Import, Props mit Typen und erlaubten Werten, Defaults, Richtlinien, A11y, Regeln.',
    inputSchema: obj({ name: str('Komponentenname, z. B. Button') }, ['name']),
    run: ({ name }) => {
      const m = model();
      const c = components(m.manifest).get(name);
      if (!c) throw new Error(`Komponente ${name} gibt es in ${m.manifest.name} nicht. Mit ds_search suchen.`);
      return { import: `import { ${name} } from '${m.manifest.package}';`, ...c };
    },
  },
  {
    name: 'ds_patterns',
    description: 'Pattern-Karten des Design Systems. Ohne id: Liste; mit id: vollständige Karte (Auslöser, Entscheidungsregeln, verlangte Zustände).',
    inputSchema: obj({ id: str('Pattern-ID, z. B. saving') }),
    run: ({ id }) => {
      const m = model();
      if (!id) return m.patterns.map(p => ({ id: p.id, name: p.meta.name || p.id, status: p.meta.status }));
      const p = m.patterns.find(x => x.id === id);
      if (!p) throw new Error(`Pattern ${id} nicht gefunden`);
      return p.text;
    },
  },
  {
    name: 'ds_tokens',
    description: 'Alle Design Tokens mit aufgelösten Werten (für Props vom Typ token, z. B. padding="space.4").',
    inputSchema: obj({}),
    run: () => loadTokens(model()).map(t => ({ token: t.path, typ: t.type, wert: t.css })),
  },
  {
    name: 'journey_get',
    description: 'Liest eine User Journey als Story Map (wireflow/journey@2) samt offenen Punkten (ohne id: alle, ohne Befunde).',
    inputSchema: obj({ id: str('Journey-ID') }),
    run: ({ id }) => {
      const m = model();
      if (!id) return m.journeys;
      const j = m.journeys.find(x => x.id === id);
      if (!j) throw new Error('Journey nicht gefunden');
      return { ...j, offen: journeyGaps(j, m) };
    },
  },
  {
    name: 'journey_upsert',
    description: 'Legt eine Journey an oder ersetzt sie (Story Map, wireflow/journey@2): phases[] → steps[] { text, painPoints[] { text, insight? }, needs[] { text, insight?, solves[painPointId], requirements[] { text, screens[Knoten-ID], partial? } } }. Bis zu den Bedarfen ohne Lösung formulieren; erst Anforderungen nennen Screens. Das alte Format (actions[], painPoints[] je Phase) wird übernommen. Gibt die offenen Punkte zurück.',
    inputSchema: obj({ journey: { type: 'object', description: 'Journey-Objekt mit id, title, phases[]' } }, ['journey']),
    run: ({ journey }) => {
      const m = model();
      const r = saveJourney(m, journey);
      return { gespeichert: path.join(WF, r.file), offen: journeyGaps(r.journey, m) };
    },
  },
  {
    name: 'flow_get',
    description: 'Liest einen Flow mit Befunden der Integritätsprüfung und dem Wissensstand je Knoten.',
    inputSchema: obj({ id: str('Flow-ID (ohne: erster Flow)') }),
    run: ({ id }) => {
      const m = model();
      const f = flowById(m, id);
      if (!f) throw new Error('Flow nicht gefunden');
      return { flow: f, befunde: flowIssues(f, m), wissen: flowKnowledge(f, m.knowledge) };
    },
  },
  {
    name: 'flow_upsert',
    description: 'Legt einen Flow an oder ersetzt ihn. Knoten: {id, type: screen|decision, title|label, ref (screens/x.screen.tsx), x, y, basis:{insights[], assumptions[]}}; Kanten: {from, el (data-wf des auslösenden Elements), to, label, when (Variable oder else), set}.',
    inputSchema: obj({ flow: { type: 'object', description: 'Flow-Objekt mit id, title, entry, nodes[], edges[]' } }, ['flow']),
    run: ({ flow }) => {
      if (!flow.id || !Array.isArray(flow.nodes) || !Array.isArray(flow.edges)) throw new Error('flow braucht id, nodes[] und edges[]');
      const m = model();
      const existing = m.flows.find(f => f.id === flow.id);
      const file = path.join(m.wf, existing?.file || `flows/${slug(flow.title || flow.id)}.flow.json`);
      const { file: _f, ...data } = flow;
      writeJson(file, { schema: 'wireflow/flow@1', ...data });
      const fresh = model();
      return { gespeichert: path.relative(m.root, file), befunde: flowIssues(flowById(fresh, flow.id), fresh) };
    },
  },
  {
    name: 'flow_edit',
    description: 'Strukturierte Änderung an einem Flow – wie auf dem Canvas. op: addScreen {title, x, y, ref?} (legt Screen-Modul aus DS-Komponenten an) | addDecision {label, var, x, y} | connect {from, el?, to, label?, when?} (verdrahtet flow.trigger im Code) | updateEdge {index, props} | disconnect {index} | moveNode {id, x, y} | setNode {id, props:{title,label,var,story,exit}} | removeNode {id} | setEntry {id} | setVariable {name, value} | addSection {title, x, y, w, h, phase?} (Sektion: fasst Screens zu einer Phase zusammen, phase = Phasen-ID der Journey) | updateSection {id, props:{title,x,y,w,h,phase}} | removeSection {id}.',
    inputSchema: obj({
      flow: str('Flow-ID (ohne: erster Flow)'),
      op: { type: 'string', enum: ['addScreen', 'addDecision', 'connect', 'updateEdge', 'disconnect', 'moveNode', 'setNode', 'removeNode', 'setEntry', 'setVariable', 'addSection', 'updateSection', 'removeSection'] },
      id: str('Knoten-ID'), from: str('Start-Knoten'), to: str('Ziel-Knoten'), el: str('data-wf des auslösenden Elements'),
      label: str('Beschriftung'), when: str('Variable oder else'), title: str('Titel eines neuen Screens'), ref: str('bestehendes Screen-Modul'),
      var: str('Variable einer Entscheidung'), name: str('Variablenname'), value: { description: 'Variablenwert' },
      index: { type: 'number' }, x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' }, phase: str('Phasen-ID der Journey (Sektion)'), props: { type: 'object' },
    }, ['op']),
    run: ({ flow, ...op }) => {
      const m = model();
      const r = applyFlowOp(m, flow, op);
      const fresh = model();
      const f = flowById(fresh, r.flow);
      return { ...r, befunde: flowIssues(f, fresh) };
    },
  },
  {
    name: 'flow_validate',
    description: 'Prüft Flows: fehlende Ja/Nein-Pfade, unerreichbare Screens, Sackgassen, fehlende Hotspots im Code.',
    inputSchema: obj({ id: str('Flow-ID (ohne: alle)') }),
    run: ({ id }) => {
      const m = model();
      return (id ? [flowById(m, id)] : m.flows).filter(Boolean).map(f => ({ flow: f.id, befunde: flowIssues(f, m) }));
    },
  },
  {
    name: 'screen_get',
    description: 'Liest ein Screen-Modul: Quelltext (TSX), Elemente mit data-wf-IDs, Stories und Prüfergebnis.',
    inputSchema: obj({ ref: str('Pfad relativ zu .wireflow, z. B. screens/profil.screen.tsx') }, ['ref']),
    run: ({ ref }) => {
      const m = model();
      const s = m.screens[ref];
      if (!s) throw new Error(`Screen ${ref} nicht gefunden`);
      return { ref, komponente: s.component, stories: s.stories, quelltext: s.source, elemente: s.tree ? elements(s.tree) : [], pruefung: lintScreen(s, m) };
    },
  },
  {
    name: 'screen_write',
    description: 'Schreibt ein ganzes Screen-Modul (TSX) nach Prüfung. Regeln: nur Komponenten des DS-Pakets, keine style/className, Props und Tokens laut Manifest, Navigation über flow.trigger(\'<id>\') und flow.back, data-wf-IDs an jedem Element (fehlende werden ergänzt). Bei Fehlern wird nicht geschrieben (force=true erzwingt).',
    inputSchema: obj({ ref: str('Ziel, z. B. screens/slot-vergeben.screen.tsx'), source: str('Vollständiger TSX-Quelltext'), force: { type: 'boolean' } }, ['ref', 'source']),
    run: ({ ref, source, force }) => {
      if (!/^screens\/[\w-]+\.screen\.tsx$/.test(ref)) throw new Error('ref muss screens/<name>.screen.tsx sein');
      const r = writeScreen(model(), ref, source, { force });
      return r.ok ? { gespeichert: ref, pruefung: r.lint } : { gespeichert: false, ...r };
    },
  },
  {
    name: 'screen_edit',
    description: 'Strukturierte Änderung an einem Screen-Modul – wie auf dem Canvas. op: insert {component, parent?, index?, props?, text?} | remove {id} | move {id, delta|index, parent?} | duplicate {id} | setProp {id, name, value} | setText {id, text} | swap {id, component} (Komponente tauschen, passende Props bleiben).',
    inputSchema: obj({
      ref: str('Screen, z. B. screens/profil.screen.tsx'),
      op: { type: 'string', enum: ['insert', 'remove', 'move', 'duplicate', 'setProp', 'setText', 'swap'] },
      id: str('data-wf des Elements'), component: str('DS-Komponente für insert'), parent: str('data-wf des Elternelements'),
      index: { type: 'number' }, delta: { type: 'number' }, name: str('Prop-Name'), value: { description: 'Prop-Wert (String, Zahl, Boolean, Liste oder {expr:"…"})' },
      text: str('Text'), props: { type: 'object' },
    }, ['ref', 'op']),
    run: ({ ref, ...op }) => {
      const m = model();
      const r = applyOpRecorded(m, ref, op, 'Claude');
      const fresh = model();
      return { ...r, pruefung: lintScreen(fresh.screens[ref], fresh) };
    },
  },
  {
    name: 'screen_lint',
    description: 'Prüft Screen-Module gegen DS, Richtlinien und Regeln (ohne ref: alle).',
    inputSchema: obj({ ref: str('Screen') }),
    run: ({ ref }) => {
      const m = model();
      return Object.values(m.screens).filter(s => !ref || s.ref === ref).map(s => ({ ref: s.ref, ...lintScreen(s, m) }));
    },
  },
  {
    name: 'knowledge_get',
    description: 'Wissensbasis: Insights (mit Wissensstand), Annahmen (nach Risiko sortiert), offene Fragen.',
    inputSchema: obj({}),
    run: () => {
      const m = model();
      return { ...m.knowledge, annahmenNachRisiko: openAssumptions(m.knowledge).map(a => a.id) };
    },
  },
  {
    name: 'knowledge_upsert',
    description: 'Legt Wissen an oder ändert es. kind: insight {id, aussage, fakten[], wissensstand: belegt|hinweis} | assumption {id, aussage, kategorie, wichtigkeit, evidenz, test, status} | question {id, frage, methode, status}. Nie Nutzerwissen erfinden: ohne Quelle ist es eine Annahme.',
    inputSchema: obj({ kind: { type: 'string', enum: ['insight', 'assumption', 'question'] }, item: { type: 'object' } }, ['kind', 'item']),
    run: ({ kind, item }) => {
      if (!item?.id) throw new Error('item braucht eine id');
      if (kind === 'insight' && item.wissensstand === 'belegt' && !(item.fakten || []).length) throw new Error('Ein belegter Insight braucht Fakten mit Quelle.');
      const m = model();
      const file = path.join(m.wf, 'knowledge', { insight: 'insights', assumption: 'assumptions', question: 'questions' }[kind] + '.json');
      const list = readJson(file, []);
      const i = list.findIndex(x => x.id === item.id);
      if (i >= 0) list[i] = { ...list[i], ...item }; else list.push(item);
      writeJson(file, list);
      return { gespeichert: item.id, datei: path.relative(m.root, file) };
    },
  },
  {
    name: 'knowledge_status',
    description: 'Wissensstand je Flow-Knoten und -Kante: belegt, hinweis, annahme, offen, widerspruch – mit Verweisen.',
    inputSchema: obj({ flow: str('Flow-ID') }),
    run: ({ flow }) => {
      const m = model();
      const f = flowById(m, flow);
      if (!f) throw new Error('Flow nicht gefunden');
      return flowKnowledge(f, m.knowledge);
    },
  },
  {
    name: 'canvas_open',
    description: 'Startet den Canvas (lokale Web-App) und gibt die URL zurück. Den Link der Person nennen.',
    inputSchema: obj({ port: { type: 'number' } }),
    run: async ({ port }) => {
      const { startCanvas } = await import('../canvas/server.js');
      const root = rootDir();
      const c = await startCanvas({ root, port, bridge: bridgeFor(root) });
      return {
        url: c.url,
        hinweis: 'Canvas läuft, solange diese Claude-Code-Sitzung läuft. Nachrichten aus dem Chat im Canvas kommen als <channel …> (mit Kanal) oder über canvas_inbox; antworten mit canvas_reply.',
      };
    },
  },
  {
    name: 'canvas_reply',
    description: 'Antwortet im Chat des Canvas – auf Nachrichten, die als <channel … chat_id="…"> oder über canvas_inbox kamen. Kurz und konkret; Änderungen an Screens und Flows erscheinen ohnehin live im Canvas.',
    inputSchema: obj({ text: str('Antwort (einfaches Markdown: Absätze, - Listen, **fett**, `code`)'), chat_id: str('chat_id der Nachricht, auf die du antwortest') }, ['text']),
    run: ({ text, chat_id }) => {
      const r = bridgeFor().reply({ text, chat_id });
      return { gesendet: true, id: r.id };
    },
  },
  {
    name: 'canvas_inbox',
    description: 'Offene Nachrichten aus dem Chat des Canvas (mit Auswahl-Kontext). Aufrufen, wenn ein Hook oder die Person auf wartende Canvas-Nachrichten hinweist; danach mit canvas_reply antworten.',
    inputSchema: obj({}),
    run: () => {
      const offen = bridgeFor().inbox();
      return offen.length ? { offen } : { offen: [], hinweis: 'Keine offenen Nachrichten im Canvas.' };
    },
  },
  {
    name: 'variant_create',
    description: 'Legt eine Variante eines Screens an; sie erscheint im Canvas neben dem Original und kann dort getauscht oder verworfen werden. mode: strict (nur DS-Komponenten, Props, Tokens und Patterns; Aufbau nah am Original) | guided (DS-Komponenten, Aufbau und Hierarchie frei; Patterns und Insights als Leitplanke) | free (kreativ, DS-Lücken erlaubt, aber benennen). Hotspot-IDs (data-wf der Verbindungen im Flow) beibehalten.',
    inputSchema: obj({
      ref: str('Original, z. B. screens/profil.screen.tsx'),
      mode: { type: 'string', enum: ['strict', 'guided', 'free'] },
      label: str('kurzer Name der Variante, z. B. „Kompakt“'),
      source: str('vollständiger TSX-Quelltext der Variante'),
      rationale: str('Unterschied zum Original und Begründung in einem Satz'),
      flow: str('Flow-ID (optional)'),
    }, ['ref', 'mode', 'source']),
    run: ({ ref, mode, label, source, rationale, flow }) => {
      assertScreenRef(ref);
      const m = model();
      const f = flow ? flowById(m, flow) : m.flows.find(x => (x.nodes || []).some(n => n.ref === ref));
      const node = f?.nodes.find(n => n.ref === ref);
      if (!node) throw new Error(`${ref} gehört zu keinem Flow-Knoten – Varianten hängen an einem Screen im Flow.`);
      const base = path.basename(ref, '.screen.tsx').replace(/--.*$/, '');
      const s = slugify(label || MODES[mode] || mode);
      let target = `screens/${base}--${s}.screen.tsx`;
      for (let k = 2; fs.existsSync(path.join(m.wf, target)); k++) target = `screens/${base}--${s}-${k}.screen.tsx`;
      const r = writeScreen(m, target, source, { force: mode === 'free' });
      if (!r.ok) return { gespeichert: false, ...r, hinweis: 'Nicht gespeichert – Fehler beheben und erneut senden.' };
      if (mode === 'strict' && r.lint.warnings.some(w => w.gap)) {
        undoLast();
        return { gespeichert: false, pruefung: r.lint, hinweis: 'Strikt erlaubt keine DS-Lücken – nur Komponenten aus dem Manifest.' };
      }
      const tree = loadScreen(m.root, target).tree;
      const fehlend = (f.edges || []).filter(e => e.from === node.id && e.el && !(tree && findById(tree, e.el))).map(e => e.el);
      applyFlowOp(model(), f.id, { op: 'addVariant', id: node.id, ref: target, mode, label: label || MODES[mode], rationale, by: 'Claude' });
      return {
        gespeichert: target,
        knoten: node.id,
        pruefung: r.lint,
        ...(fehlend.length ? { fehlendeHotspots: fehlend, hinweis: 'Diese Hotspot-IDs fehlen – nach dem Tauschen wären Verbindungen kaputt.' } : {}),
      };
    },
  },
  {
    name: 'canvas_selection',
    description: 'Was die Person gerade im Canvas ausgewählt hat (Screen, Element, Modus). Für Aufträge wie „ändere das Ausgewählte“.',
    inputSchema: obj({}),
    run: () => {
      const m = model();
      return readJson(path.join(m.wf, '.canvas-state.json'), { auswahl: null, hinweis: 'Im Canvas ist nichts ausgewählt.' });
    },
  },
  {
    name: 'export',
    description: 'Exporte: mermaid (Flowchart) oder spec (Markdown-Spezifikation mit Screens, Zuständen, Interaktionen, Akzeptanzkriterien).',
    inputSchema: obj({ format: { type: 'string', enum: ['mermaid', 'spec'] }, flow: str('Flow-ID') }, ['format']),
    run: ({ format, flow }) => {
      const m = model();
      const f = flowById(m, flow);
      if (!f) throw new Error('Flow nicht gefunden');
      if (format === 'mermaid') return toMermaid(f, m);
      const L = [`# ${f.title}`, '', '```mermaid', toMermaid(f, m), '```', ''];
      for (const n of f.nodes || []) {
        if (n.type !== 'screen') continue;
        const s = m.screens[n.ref];
        L.push(`## ${n.title || n.id}`, '', `- Datei: \`.wireflow/${n.ref}\``, `- Zustände (Stories): ${s?.stories?.join(', ') || '–'}`);
        for (const e of (f.edges || []).filter(e => e.from === n.id)) {
          const to = f.nodes.find(x => x.id === e.to);
          L.push(`- Interaktion: ${e.el ? `\`${e.el}\`` : 'Screen'} → ${to?.title || to?.label || e.to}${e.set ? ` (setzt ${Object.keys(e.set).join(', ')})` : ''}`);
          L.push(`  - Gegeben ${n.title || n.id}, wenn „${e.label || e.el}“ ausgelöst wird, dann erscheint ${to?.title || to?.label || e.to}.`);
        }
        L.push('');
      }
      const issues = flowIssues(f, m);
      if (issues.length) L.push('## Offene Befunde', '', ...issues.map(i => `- ${i.level}: ${i.message}`), '');
      return L.join('\n');
    },
  },
  {
    name: 'undo',
    description: 'Macht die letzte Datei-Änderung dieses Servers rückgängig.',
    inputSchema: obj({}),
    run: () => {
      const f = undoLast();
      return f ? { rueckgaengig: path.relative(process.cwd(), f) } : { rueckgaengig: null, hinweis: 'Nichts zum Rückgängigmachen.' };
    },
  },
];

export function toolNames() { return TOOLS.map(t => t.name); }
export { WF, fs };
