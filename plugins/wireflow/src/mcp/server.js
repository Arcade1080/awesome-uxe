// Abhängigkeitsfreier MCP-Server (JSON-RPC 2.0 über stdio, eine Nachricht pro Zeile).
import readline from 'node:readline';
import { TOOLS, setNotifier, activityFor } from './tools.js';

const FALLBACK = '2025-06-18';
const INSTRUCTIONS = [
  'Wireflow Studio: Journeys, Wireflows und Prototypen aus echtem Code des verknüpften Design Systems.',
  'Zuerst project_status. Screens sind TSX-Screen-Module unter .wireflow/screens – nur DS-Komponenten (ds_search, ds_component),',
  'Patterns beachten (ds_patterns), Änderungen über screen_edit oder screen_write. Nutzerwissen nie erfinden: ohne Quelle ist es eine Annahme (knowledge_upsert).',
  'Chat im Canvas: Nachrichten kommen als <channel … chat_id="…" screen="…" element="…"> (Kanal) oder über canvas_inbox.',
  'Sie beziehen sich auf die Auswahl im Canvas. Erledige die Bitte mit den Wireflow-Werkzeugen und antworte immer mit canvas_reply (chat_id übernehmen).',
  'Jede chat_id nur einmal beantworten; was schon beantwortet ist, zeigt canvas_inbox nicht mehr. Varianten mit variant_create anlegen.',
].join(' ');

export function startMcp({ input = process.stdin, output = process.stdout } = {}) {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const send = msg => output.write(JSON.stringify(msg) + '\n');
  setNotifier((method, params) => send({ jsonrpc: '2.0', method, params }));
  rl.on('line', async line => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    const { id, method, params } = msg;
    if (id === undefined || id === null) return; // Notification
    try {
      let result;
      if (method === 'initialize') {
        result = {
          protocolVersion: params?.protocolVersion || FALLBACK,
          // claude/channel: Nachrichten aus dem Canvas-Chat in die Sitzung schieben (Research Preview).
          capabilities: { tools: { listChanged: false }, experimental: { 'claude/channel': {} } },
          serverInfo: { name: 'wireflow', title: 'Wireflow Studio', version: '0.2.0' },
          instructions: INSTRUCTIONS,
        };
      } else if (method === 'ping') {
        result = {};
      } else if (method === 'tools/list') {
        result = { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) };
      } else if (method === 'tools/call') {
        const tool = TOOLS.find(t => t.name === params?.name);
        if (!tool) throw Object.assign(new Error(`Unbekanntes Tool: ${params?.name}`), { code: -32602 });
        try {
          activityFor(tool.name, params.arguments || {});
          const out = await tool.run(params.arguments || {});
          result = { content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 2) }] };
        } catch (e) {
          result = { content: [{ type: 'text', text: `Fehler: ${e.message}` }], isError: true };
        }
      } else {
        throw Object.assign(new Error(`Methode nicht gefunden: ${method}`), { code: -32601 });
      }
      send({ jsonrpc: '2.0', id, result });
    } catch (e) {
      send({ jsonrpc: '2.0', id, error: { code: e.code || -32603, message: e.message } });
    }
  });
  return rl;
}
