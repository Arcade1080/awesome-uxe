import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';
import { CLI, tempProject, read } from './helpers.js';

// MCP-Server als Kindprozess; sammelt Antworten und Benachrichtigungen (Kanal).
function mcp(root, dataDir) {
  const proc = spawn(process.execPath, [CLI, 'mcp'], {
    env: { ...process.env, WIREFLOW_ROOT: root, WIREFLOW_INBOX_DIR: dataDir, WIREFLOW_PORT: '0' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const pending = new Map();
  const notes = [];
  let wake = null;
  readline.createInterface({ input: proc.stdout }).on('line', line => {
    const msg = JSON.parse(line);
    if (msg.id != null) { pending.get(msg.id)?.(msg); pending.delete(msg.id); } else { notes.push(msg); wake?.(); }
  });
  let n = 0;
  const call = (method, params) => new Promise(resolve => {
    const id = ++n;
    pending.set(id, resolve);
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const tool = async (name, args = {}) => {
    const r = await call('tools/call', { name, arguments: args });
    const text = r.result.content[0].text;
    try { return { data: JSON.parse(text), isError: !!r.result.isError }; } catch { return { data: text, isError: !!r.result.isError }; }
  };
  const note = (ms = 3000) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('keine Kanal-Nachricht')), ms);
    const check = () => { if (notes.length) { clearTimeout(t); resolve(notes.shift()); } else wake = check; };
    check();
  });
  return { call, tool, note, close: () => proc.kill() };
}

async function login(url) {
  const r = await fetch(url, { redirect: 'manual' });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return { cookie, base: new URL(url).origin };
}

test('Chat im Canvas: Kanal-Nachricht an Claude, Antwort zurück, Inbox und Hooks', async () => {
  const root = tempProject();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'wireflow-data-'));
  const c = mcp(root, data);
  try {
    const init = await c.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    assert.deepEqual(init.result.capabilities.experimental, { 'claude/channel': {} });
    assert.match(init.result.instructions, /canvas_reply/);

    const open = await c.tool('canvas_open');
    const { cookie, base } = await login(open.data.url);
    const post = body => fetch(`${base}/api/chat`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });

    const sel = { flow: 'flw_buchung', knoten: 'scr_profil', titel: 'Profil & Termine', screen: 'screens/profil.screen.tsx', element: 'btn_weiter', komponente: 'Button', 'ungültig-key': 'x' };
    const r = await (await post({ text: 'Mach den Button sekundär', selection: sel })).json();
    assert.equal(r.ok, true);
    const n = await c.note();
    assert.equal(n.method, 'notifications/claude/channel');
    assert.equal(n.params.meta.chat_id, r.message.id);
    assert.equal(n.params.meta.element, 'btn_weiter');
    assert.equal(n.params.meta['ungültig-key'], undefined, 'nur Buchstaben, Ziffern, Unterstrich');
    assert.ok(Object.keys(n.params.meta).every(k => /^[A-Za-z0-9_]+$/.test(k)));
    assert.match(n.params.content, /^Mach den Button sekundär\n\n\[Auswahl im Canvas: Screen „Profil & Termine“ \(screens\/profil\.screen\.tsx\) Element btn_weiter <Button>\]$/);

    // Rückfallweg: Hooks sehen die offene Nachricht
    const hook = event => spawnSync(process.execPath, [CLI, 'hook-inbox'], {
      input: JSON.stringify({ hook_event_name: event, cwd: root, stop_hook_active: false }),
      env: { ...process.env, WIREFLOW_INBOX_DIR: data, WIREFLOW_ROOT: root },
      encoding: 'utf8',
    });
    const ups = JSON.parse(hook('UserPromptSubmit').stdout);
    assert.match(ups.hookSpecificOutput.additionalContext, new RegExp(`chat_id ${r.message.id}`));
    const stop = JSON.parse(hook('Stop').stdout);
    assert.equal(stop.decision, 'block');

    // Claude holt ab (gelesen) und antwortet (beantwortet)
    const inbox = await c.tool('canvas_inbox');
    assert.equal(inbox.data.offen[0].chat_id, r.message.id);
    const reply = await c.tool('canvas_reply', { text: 'Erledigt: **btn_weiter** ist jetzt `secondary`.', chat_id: r.message.id });
    assert.equal(reply.data.gesendet, true);
    const log = await (await fetch(`${base}/api/chat`, { headers: { cookie } })).json();
    assert.equal(log.connected, true);
    assert.equal(log.messages.find(m => m.id === r.message.id).status, 'beantwortet');
    assert.equal(log.messages.at(-1).role, 'claude');
    assert.equal(hook('Stop').stdout, '', 'nichts mehr offen – Stop wird nicht blockiert');

    // Aktivität: Werkzeug-Aufrufe erscheinen im Chat
    await c.tool('screen_get', { ref: 'screens/profil.screen.tsx' });
    const log2 = await (await fetch(`${base}/api/chat`, { headers: { cookie } })).json();
    assert.ok(log2.messages.some(m => m.role === 'activity' && m.ref === 'screens/profil.screen.tsx'));

    // Varianten: strikt nur mit DS-Komponenten; Variante hängt am Flow-Knoten
    const src = read(root, 'screens/profil.screen.tsx').replace('variant="primary"', 'variant="secondary"');
    const v = await c.tool('variant_create', { ref: 'screens/profil.screen.tsx', mode: 'strict', label: 'Ruhiger', source: src, rationale: 'Weniger Gewicht auf Weiter.' });
    assert.equal(v.data.gespeichert, 'screens/profil--ruhiger.screen.tsx');
    const flow = JSON.parse(read(root, 'flows/buchung.flow.json'));
    assert.deepEqual(flow.nodes.find(x => x.id === 'scr_profil').variants, [{ ref: 'screens/profil--ruhiger.screen.tsx', mode: 'strict', label: 'Ruhiger', rationale: 'Weniger Gewicht auf Weiter.', by: 'Claude' }]);
    const gap = await c.tool('variant_create', { ref: 'screens/bestaetigung.screen.tsx', mode: 'strict', source: read(root, 'screens/bestaetigung.screen.tsx') });
    assert.equal(gap.data.gespeichert, false, 'Strikt lehnt DS-Lücken ab');
    assert.equal(fs.existsSync(path.join(root, '.wireflow/screens/bestaetigung--strikt.screen.tsx')), false);

    // Tauschen und Verwerfen über den Canvas
    const flowOp = body => fetch(`${base}/api/flow`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ flow: 'flw_buchung', ...body }) }).then(x => x.json());
    const sw = await flowOp({ op: 'promoteVariant', id: 'scr_profil', ref: 'screens/profil--ruhiger.screen.tsx' });
    assert.equal(sw.ok, true);
    let f2 = JSON.parse(read(root, 'flows/buchung.flow.json'));
    const node = f2.nodes.find(x => x.id === 'scr_profil');
    assert.equal(node.ref, 'screens/profil--ruhiger.screen.tsx');
    assert.equal(node.variants[0].ref, 'screens/profil.screen.tsx');
    await flowOp({ op: 'promoteVariant', id: 'scr_profil', ref: 'screens/profil.screen.tsx' });
    const del = await flowOp({ op: 'discardVariant', id: 'scr_profil', ref: 'screens/profil--ruhiger.screen.tsx' });
    assert.equal(del.removed, 'screens/profil--ruhiger.screen.tsx');
    assert.equal(fs.existsSync(path.join(root, '.wireflow/screens/profil--ruhiger.screen.tsx')), false);
    f2 = JSON.parse(read(root, 'flows/buchung.flow.json'));
    assert.equal(f2.nodes.find(x => x.id === 'scr_profil').variants, undefined);

    // Quelltext mit Zeilen je Element für den Code-Tab
    const code = await (await fetch(`${base}/api/source?ref=screens/profil.screen.tsx`, { headers: { cookie } })).json();
    assert.deepEqual(code.lines.btn_weiter, [14, 14]);
    assert.match(code.stories, /export const KeineTermine/);
  } finally {
    c.close();
  }
});

test('Canvas ohne Claude-Sitzung (wireflow serve) lehnt Chat-Nachrichten verständlich ab', async () => {
  const { startCanvas } = await import('../src/canvas/server.js');
  const root = tempProject();
  const c = await startCanvas({ root, port: 0 });
  try {
    const { cookie, base } = await login(c.url);
    const info = await (await fetch(`${base}/api/chat`, { headers: { cookie } })).json();
    assert.equal(info.connected, false);
    const r = await fetch(`${base}/api/chat`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Hallo' }) });
    assert.equal(r.status, 409);
    assert.match((await r.json()).error, /\/wireflow:canvas/);
  } finally {
    await c.close();
  }
});

// Browser: Kontextmenü → Varianten „Strikt“ → Kanal → Antwort erscheint im Chat
import { createRequire } from 'node:module';
import { hasRenderer } from './helpers.js';
let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* optional */ }

test('Canvas im Browser: Kontextmenü schickt Auftrag an Claude, Antwort erscheint im Chat', { skip: (!chromium || !hasRenderer()) && 'Playwright oder Renderer fehlt' }, async () => {
  const root = tempProject();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'wireflow-data-'));
  const c = mcp(root, data);
  const browser = await chromium.launch();
  try {
    await c.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    const { url } = (await c.tool('canvas_open')).data;
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => [...document.querySelectorAll('.node.scr iframe')].length === 6 && [...document.querySelectorAll('.node.scr iframe')].every(f => f.contentDocument?.querySelector('[data-wf]')), null, { timeout: 15000 });
    assert.deepEqual(await page.$$eval('#right .tabs button', b => b.map(x => x.textContent)), ['Design', 'Code', 'Chat']);
    assert.match(await page.textContent('.gapcard'), /Nein-Pfad fehlt/);

    // Rechtsklick auf den Titel öffnet das Kontextmenü für den Screen
    const t = await page.locator('.node[data-node="scr_profil"] .ftitle b').boundingBox();
    await page.mouse.click(t.x + 5, t.y + t.height / 2, { button: 'right' });
    await page.waitForSelector('#radial .ritem');
    assert.deepEqual(await page.$$eval('#radial .ritem .rl', b => b.map(x => x.textContent)), ['Varianten', 'Weiter', 'Zustände', 'Code', 'Chat', 'Review']);
    await page.click('#radial .ritem:has-text("Varianten")');
    assert.deepEqual(await page.$$eval('#radial .rpill', b => b.map(x => x.textContent)), ['Strikt', 'Geführt', 'Frei']);
    await page.click('#radial .rpill:has-text("Strikt")');

    const note = await c.note();
    assert.equal(note.params.meta.knoten, 'scr_profil');
    assert.equal(note.params.meta.art, 'varianten');
    assert.match(note.params.content, /Modus Strikt/);
    await page.waitForSelector('#right .cmsg.user');
    await c.tool('canvas_reply', { chat_id: note.params.meta.chat_id, text: 'Zwei Varianten liegen **neben** dem Screen.' });
    await page.waitForSelector('#right .cmsg.claude b');
    assert.equal(await page.textContent('#right .cmsg.claude b'), 'neben');
    assert.match(await page.textContent('#right .cmsg.user .cmeta'), /beantwortet/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    c.close();
  }
});


test('Plugin-Monitor „canvas-chat“: druckt neue Canvas-Nachrichten als Zeile, Kanal und Hooks halten sich zurück', async () => {
  const root = tempProject();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wireflow-data-'));
  process.env.WIREFLOW_INBOX_DIR = dir;
  const { createBridge, monitorAlive } = await import('../src/mcp/bridge.js');
  const mon = spawn(process.execPath, [CLI, 'monitor', '--root', root], { env: { ...process.env, WIREFLOW_INBOX_DIR: dir }, stdio: ['ignore', 'pipe', 'inherit'] });
  const lines = [];
  readline.createInterface({ input: mon.stdout }).on('line', l => lines.push(l));
  const until = async (fn, ms = 4000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('Zeitüberschreitung'); await new Promise(r => setTimeout(r, 50)); } };
  const hook = event => spawnSync(process.execPath, [CLI, 'hook-inbox'], { input: JSON.stringify({ hook_event_name: event, cwd: root }), env: { ...process.env, WIREFLOW_INBOX_DIR: dir, WIREFLOW_ROOT: root }, encoding: 'utf8' });
  try {
    await until(() => monitorAlive(root));
    const sent = [];
    const b = createBridge({ root, notify: (method, params) => sent.push(params) });
    const m = b.userMessage({ text: 'Zeig mir\nzwei Varianten', selection: { titel: 'Profil & Termine', screen: 'screens/profil.screen.tsx', element: 'btn_weiter', komponente: 'Button' } });
    await until(() => lines.length > 0);
    assert.equal(lines.length, 1);
    assert.match(lines[0], new RegExp(`^Nachricht aus dem Wireflow-Canvas \\(chat_id ${m.id}\\): „Zeig mir ⏎ zwei Varianten“ – Auswahl: „Profil & Termine“ · screens/profil.screen.tsx · Element btn_weiter <Button> – `));
    assert.deepEqual(sent, [], 'kein doppelter Kanal, solange der Monitor zustellt');
    assert.equal(hook('UserPromptSubmit').stdout, '', 'Hook schweigt, der Monitor hat zugestellt');
    assert.equal(hook('Stop').stdout, '', 'noch nicht gelesen – Stop blockiert nicht');
    b.inbox();
    assert.equal(JSON.parse(hook('Stop').stdout).decision, 'block', 'gelesen, aber nicht beantwortet');
    b.reply({ text: 'Erledigt.', chat_id: m.id });
    assert.equal(hook('Stop').stdout, '');
    await new Promise(r => setTimeout(r, 800));
    assert.equal(lines.length, 1, 'jede Nachricht nur einmal');
    mon.kill('SIGTERM');
    await until(() => !monitorAlive(root));
    b.userMessage({ text: 'Ohne Monitor' });
    assert.equal(sent.length, 1, 'ohne Monitor geht die Nachricht über den Kanal');
    b.close();
  } finally {
    mon.kill();
    delete process.env.WIREFLOW_INBOX_DIR;
  }
});
