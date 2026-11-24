// Kommandozeile: wireflow <befehl>. Wird vom MCP-Server, den Hooks und von Hand genutzt.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { findRoot, loadProject, flowById, WF, readJson } from './core/project.js';
import { lintScreen } from './core/lint.js';
import { flowIssues, toMermaid } from './core/flow.js';
import { flowKnowledge, openAssumptions } from './core/knowledge.js';
import { initProject, packageDir } from './core/init.js';
import { loadScreen } from './core/project.js';

const HELP = `wireflow – Wireflow Studio für Claude Code

  wireflow init [--ds <paket>] [--name <name>]   .wireflow/ anlegen, Design System verknüpfen
  wireflow serve [--port <n>] [--open]          Canvas starten (lokale Web-App)
  wireflow status                               Überblick: DS, Flows, Screens, Wissen
  wireflow validate                             Flows und Screens prüfen (Exit-Code 1 bei Fehlern)
  wireflow lint [screens/x.screen.tsx]          Screens gegen das Design System prüfen
  wireflow export mermaid|spec [flow-id]        Flow exportieren
  wireflow doctor [--brief]                     Einrichtung prüfen
  wireflow mcp                                  MCP-Server (stdio) – startet Claude Code selbst
  wireflow hook-validate                        PostToolUse-Hook (liest JSON von stdin)
`;

function flag(args, name, fallback) {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

function requireRoot() {
  const root = findRoot(process.env.WIREFLOW_ROOT || undefined);
  if (!root) {
    console.error('Kein Wireflow-Projekt gefunden (.wireflow/project.json). Mit „wireflow init“ oder /wireflow:init anlegen.');
    process.exit(1);
  }
  return root;
}

function readStdin() {
  return new Promise(resolve => {
    let data = '';
    if (process.stdin.isTTY) return resolve('');
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => { data += c; });
    process.stdin.on('end', () => resolve(data));
  });
}

function printLint(ref, l) {
  const lines = [`${ref}  DS-Konformität ${l.score.pct} %`];
  for (const e of l.errors) lines.push(`  ✗ ${e.msg}`);
  for (const w of l.warnings) lines.push(`  ! ${w.msg}`);
  return lines.join('\n');
}

// ---------- Hooks ----------
async function hookValidate() {
  let input = {};
  try { input = JSON.parse((await readStdin()) || '{}'); } catch { return 0; }
  const file = input.tool_input?.file_path || input.tool_input?.path;
  if (!file) return 0;
  const abs = path.resolve(input.cwd || process.cwd(), file);
  const root = findRoot(path.dirname(abs));
  if (!root) return 0;
  const wf = path.join(root, WF);
  if (!abs.startsWith(wf + path.sep)) return 0;
  const rel = path.relative(wf, abs).split(path.sep).join('/');
  const errors = [];
  const notes = [];
  try {
    if (rel.endsWith('.json')) {
      try { JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (e) { errors.push(`${rel}: kein gültiges JSON – ${e.message}`); }
    }
    if (!errors.length && rel.endsWith('.screen.tsx')) {
      const m = loadProject(root);
      const s = loadScreen(root, rel);
      const l = lintScreen(s, m);
      l.errors.forEach(e => errors.push(`${rel}: ${e.msg}`));
      l.warnings.forEach(w => notes.push(`${rel}: ${w.msg}`));
    }
    if (!errors.length && rel.endsWith('.flow.json')) {
      const m = loadProject(root);
      const f = m.flows.find(x => x.file === rel);
      if (f) for (const i of flowIssues(f, m)) (i.level === 'error' ? errors : notes).push(`${rel}: ${i.message}`);
    }
  } catch (e) {
    errors.push(`${rel}: ${e.message}`);
  }
  if (errors.length) {
    process.stderr.write(`Wireflow-Prüfung fehlgeschlagen:\n${errors.map(e => `- ${e}`).join('\n')}\nBitte korrigieren (Regeln: nur DS-Komponenten, Props/Tokens laut Manifest, data-wf-IDs, gültige Flows).\n`);
    return 2;
  }
  if (notes.length) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `Wireflow-Hinweise:\n${notes.map(n => `- ${n}`).join('\n')}` } }));
  }
  return 0;
}

// ---------- Doctor ----------
function doctor(brief) {
  const root = findRoot(process.env.WIREFLOW_ROOT || undefined);
  if (!root) {
    if (!brief) console.log('Kein Wireflow-Projekt in diesem Repository. Mit /wireflow:init anlegen.');
    return 0;
  }
  let m;
  try { m = loadProject(root); } catch (e) {
    console.log(`Wireflow-Projekt gefunden, aber nicht lesbar: ${e.message}`);
    return brief ? 0 : 1;
  }
  const req = createRequire(path.join(root, 'package.json'));
  const can = name => { try { req.resolve(name); return true; } catch { return false; } };
  const checks = [
    ['Design-System-Manifest', (m.manifest.components || []).length > 0, `${(m.manifest.components || []).length} Komponenten (${m.manifest.name || '–'})`],
    [`Paket ${m.manifest.package || '(fehlt)'}`, !!(m.manifest.package && packageDir(root, m.manifest.package)), 'aus dem Projekt auflösbar'],
    ['esbuild', can('esbuild'), 'für den Canvas (npm i -D esbuild)'],
    ['react / react-dom', can('react') && can('react-dom/client'), 'Renderer des Design Systems'],
    ['Token-Dateien', [].concat(m.manifest.tokens?.files || []).every(f => fs.existsSync(path.resolve(root, f))), [].concat(m.manifest.tokens?.files || []).join(', ') || 'keine'],
  ];
  const flows = m.flows.map(f => ({ f, issues: flowIssues(f, m) }));
  const open = openAssumptions(m.knowledge);
  if (brief) {
    const missing = checks.filter(c => !c[1]).map(c => c[0]);
    const issues = flows.reduce((n, x) => n + x.issues.filter(i => i.level !== 'info').length, 0);
    console.log([
      `Wireflow-Projekt „${m.project.name}“: Design System ${m.manifest.name || '–'} (${(m.manifest.components || []).length} Komponenten, ${m.patterns.length} Patterns),`,
      `${m.flows.length} Flow(s) mit ${issues} Befund(en), ${Object.keys(m.screens).length} Screens, ${m.knowledge.insights.length} Insights, ${open.length} offene Annahmen.`,
      'Screens sind Code aus echten DS-Komponenten (.wireflow/screens/*.screen.tsx). Werkzeuge: MCP-Server „wireflow“; Canvas: /wireflow:canvas.',
      missing.length ? `Einrichtung unvollständig: ${missing.join(', ')} – /wireflow:init prüft das.` : '',
    ].filter(Boolean).join(' '));
    return 0;
  }
  console.log(`Projekt: ${m.project.name} (${root})`);
  for (const [name, ok, detail] of checks) console.log(`${ok ? '✓' : '✗'} ${name} – ${detail}`);
  for (const { f, issues } of flows) console.log(`Flow ${f.id}: ${issues.length ? issues.map(i => `${i.level}: ${i.message}`).join('; ') : 'ohne Befund'}`);
  return checks.every(c => c[1]) ? 0 : 1;
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  execFile(cmd, args, () => {});
}

export async function main(argv) {
  const [cmd, ...args] = argv;
  switch (cmd) {
    case 'mcp': {
      const { startMcp } = await import('./mcp/server.js');
      startMcp();
      return;
    }
    case 'serve': {
      const root = requireRoot();
      const { startCanvas } = await import('./canvas/server.js');
      const port = Number(flag(args, '--port', 0)) || undefined;
      const c = await startCanvas({ root, port });
      console.log(`Wireflow Canvas läuft: ${c.url}\n(Strg+C beendet)`);
      if (flag(args, '--open', false)) openBrowser(c.url);
      return;
    }
    case 'init': {
      const root = path.resolve(process.env.WIREFLOW_ROOT || process.env.CLAUDE_PROJECT_DIR || process.cwd());
      const r = initProject(root, { name: flag(args, '--name'), dsPackage: flag(args, '--ds') });
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    case 'status': {
      const { statusOf } = await import('./mcp/tools.js');
      console.log(JSON.stringify(statusOf(loadProject(requireRoot())), null, 2));
      return;
    }
    case 'validate':
    case 'lint': {
      const m = loadProject(requireRoot());
      let errors = 0;
      const only = cmd === 'lint' ? args[0] : null;
      for (const s of Object.values(m.screens)) {
        if (only && s.ref !== only) continue;
        const l = lintScreen(s, m);
        errors += l.errors.length;
        console.log(printLint(s.ref, l));
      }
      if (cmd === 'validate') {
        for (const f of m.flows) {
          const issues = flowIssues(f, m);
          errors += issues.filter(i => i.level === 'error').length;
          console.log(`${f.file}  ${issues.length ? '' : 'ohne Befund'}`);
          for (const i of issues) console.log(`  ${i.level === 'error' ? '✗' : i.level === 'warning' ? '!' : '·'} ${i.message}`);
          const k = flowKnowledge(f, m.knowledge).counts;
          console.log(`  Wissensstand: ${Object.entries(k).filter(([, n]) => n).map(([l, n]) => `${n}× ${l}`).join(', ')}`);
        }
      }
      process.exitCode = errors ? 1 : 0;
      return;
    }
    case 'export': {
      const m = loadProject(requireRoot());
      const [format = 'mermaid', id] = args;
      const f = flowById(m, id);
      if (!f) { console.error('Flow nicht gefunden'); process.exitCode = 1; return; }
      if (format === 'mermaid') console.log(toMermaid(f, m));
      else {
        const { TOOLS } = await import('./mcp/tools.js');
        console.log(await TOOLS.find(t => t.name === 'export').run({ format: 'spec', flow: f.id }));
      }
      return;
    }
    case 'doctor':
      process.exitCode = doctor(args.includes('--brief'));
      return;
    case 'hook-validate':
      process.exitCode = await hookValidate();
      return;
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      return;
    default:
      console.error(`Unbekannter Befehl: ${cmd}\n\n${HELP}`);
      process.exitCode = 1;
  }
}

export { readJson };
