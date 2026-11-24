import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { CLI, tempProject, read } from './helpers.js';

function client(root) {
  const proc = spawn(process.execPath, [CLI, 'mcp'], { env: { ...process.env, WIREFLOW_ROOT: root }, stdio: ['pipe', 'pipe', 'inherit'] });
  const pending = new Map();
  readline.createInterface({ input: proc.stdout }).on('line', line => {
    const msg = JSON.parse(line);
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
  });
  let id = 0;
  const call = (method, params) => new Promise(resolve => {
    const n = ++id;
    pending.set(n, resolve);
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
  });
  const tool = async (name, args = {}) => {
    const r = await call('tools/call', { name, arguments: args });
    const text = r.result.content[0].text;
    let data = text;
    try { data = JSON.parse(text); } catch { /* Text */ }
    return { data, isError: !!r.result.isError };
  };
  return { call, tool, notify: (method, params) => proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'), close: () => proc.kill() };
}

test('MCP: Handshake, Werkzeuge und Aufrufe über stdio', async () => {
  const root = tempProject();
  const c = client(root);
  try {
    const init = await c.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(init.result.serverInfo.name, 'wireflow');
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.ok(init.result.capabilities.tools);
    c.notify('notifications/initialized');

    const list = await c.call('tools/list');
    const names = list.result.tools.map(t => t.name);
    for (const n of ['project_status', 'ds_search', 'flow_edit', 'screen_edit', 'screen_write', 'knowledge_upsert', 'canvas_open', 'canvas_selection', 'export', 'undo']) assert.ok(names.includes(n), n);
    for (const t of list.result.tools) assert.equal(t.inputSchema.type, 'object', t.name);
    assert.equal(names.length, 23);

    const status = await c.tool('project_status');
    assert.equal(status.data.designSystem.komponenten, 14);
    assert.equal(status.data.flows[0].befunde.length, 1);

    const edit = await c.tool('screen_edit', { ref: 'screens/suche.screen.tsx', op: 'insert', component: 'Alert', index: 1, props: { tone: 'info', title: 'Tipp' }, text: 'Auch Videosprechstunden.' });
    assert.equal(edit.isError, false);
    assert.equal(edit.data.selected, 'alert_1');
    assert.match(read(root, 'screens/suche.screen.tsx'), /<Alert data-wf="alert_1" tone="info" title="Tipp">Auch Videosprechstunden\.<\/Alert>/);

    const bad = await c.tool('screen_edit', { ref: 'screens/suche.screen.tsx', op: 'insert', component: 'Carousel' });
    assert.equal(bad.isError, true);
    assert.match(bad.data, /keine Komponente des Design Systems/);

    const html = await c.tool('screen_write', { ref: 'screens/neu.screen.tsx', source: "export function NeuScreen() {\n  return (\n    <div>x</div>\n  );\n}\n" });
    assert.equal(html.data.gespeichert, false);

    const k = await c.tool('knowledge_upsert', { kind: 'insight', item: { id: 'ins_x', aussage: 'Ohne Beleg', wissensstand: 'belegt' } });
    assert.equal(k.isError, true, 'belegt ohne Fakten wird abgelehnt');

    const spec = await c.tool('export', { format: 'spec' });
    assert.match(spec.data, /^# Termin buchen/);
    assert.match(spec.data, /Gegeben Suche, wenn „Tippen“ ausgelöst wird, dann erscheint Ergebnisse\./);

    const undo = await c.tool('undo');
    assert.match(undo.data.rueckgaengig, /suche\.screen\.tsx$/);
    assert.doesNotMatch(read(root, 'screens/suche.screen.tsx'), /Alert/);

    const unknown = await c.call('nope/method');
    assert.equal(unknown.error.code, -32601);
  } finally {
    c.close();
  }
});
