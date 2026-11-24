// Brücke zwischen dem Chat im Canvas und der laufenden Claude-Code-Sitzung.
// Weg 1 – Kanal (Research Preview): Nachrichten erscheinen sofort in der Sitzung als
//   <channel source="…" chat_id="…" …>; Claude antwortet mit canvas_reply.
// Weg 2 – Inbox: Ohne Kanal holt Claude offene Nachrichten mit canvas_inbox ab. Die Hooks
//   UserPromptSubmit und Stop erinnern daran (Datei außerhalb des Repos, nur für diesen Nutzer).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const MAX = 400;
const clip = (s, n) => String(s ?? '').replace(/\u0000/g, '').slice(0, n);

export function inboxPath(root) {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user';
  const base = process.env.CLAUDE_PLUGIN_DATA || path.join(os.tmpdir(), `wireflow-${uid}`);
  const id = crypto.createHash('sha1').update(path.resolve(root)).digest('hex').slice(0, 16);
  return path.join(base, 'inbox', `${id}.json`);
}

// Offene Canvas-Nachrichten für die Hooks. Verwaiste Dateien (Prozess beendet) gelten als leer.
export function readInbox(root) {
  try {
    const d = JSON.parse(fs.readFileSync(inboxPath(root), 'utf8'));
    if (d.pid && d.pid !== process.pid) {
      try { process.kill(d.pid, 0); } catch { return []; }
    }
    return Array.isArray(d.pending) ? d.pending : [];
  } catch {
    return [];
  }
}

// Kanal-Attribute: nur Buchstaben, Ziffern und Unterstrich; Werte als Text.
function metaOf(sel = {}) {
  const out = {};
  for (const [k, v] of Object.entries(sel)) {
    if (v == null || v === '' || typeof v === 'object') continue;
    out[k.replace(/[^A-Za-z0-9_]/g, '_')] = clip(v, 200);
  }
  return out;
}

function channelText(m) {
  const a = m.meta || {};
  const ctx = [
    a.titel && `Screen „${a.titel}“`,
    a.screen && `(${a.screen})`,
    a.variante && `Variante ${a.variante}`,
    a.element && `Element ${a.element}${a.komponente ? ` <${a.komponente}>` : ''}`,
  ].filter(Boolean).join(' ');
  return ctx ? `${m.text}\n\n[Auswahl im Canvas: ${ctx}]` : m.text;
}

export function createBridge({ root, notify = null } = {}) {
  const log = [];
  const listeners = new Set();
  let seq = 0;
  const id = p => `${p}${Date.now().toString(36)}${(++seq).toString(36)}`;
  const emit = m => {
    for (const fn of listeners) {
      try { fn(m); } catch { /* ein Zuhörer darf die anderen nicht stören */ }
    }
  };
  const push = m => {
    log.push(m);
    if (log.length > MAX) log.splice(0, log.length - MAX);
    emit(m);
    return m;
  };
  const open = () => log.filter(m => m.role === 'user' && m.status !== 'beantwortet');
  const setStatus = (m, status) => {
    if (m.status === status) return;
    m.status = status;
    emit(m);
  };
  const persist = () => {
    const file = inboxPath(root);
    const pending = open().map(m => ({ id: m.id, text: m.text, meta: m.meta, time: m.time }));
    try {
      if (!pending.length) { fs.rmSync(file, { force: true }); return; }
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      fs.writeFileSync(file, JSON.stringify({ root, pid: process.pid, pending }, null, 2), { mode: 0o600 });
    } catch {
      /* die Inbox-Datei ist nur der Hilfsweg für Hooks */
    }
  };

  return {
    root,
    channel: typeof notify === 'function',
    log,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    userMessage({ text, selection, kind } = {}) {
      const body = clip(text, 8000).trim();
      if (!body) throw new Error('Leere Nachricht');
      const meta = metaOf({ ...(selection || {}), art: kind });
      const m = push({ id: id('c'), role: 'user', text: body, meta, time: new Date().toISOString(), status: 'gesendet' });
      persist();
      if (notify) notify('notifications/claude/channel', { content: channelText(m), meta: { chat_id: m.id, ...meta } });
      return m;
    },
    reply({ text, chat_id } = {}) {
      const body = clip(text, 20000).trim();
      if (!body) throw new Error('Leere Antwort');
      const targets = chat_id ? open().filter(m => m.id === chat_id) : open();
      targets.forEach(m => setStatus(m, 'beantwortet'));
      const r = push({ id: id('r'), role: 'claude', text: body, time: new Date().toISOString(), reply_to: chat_id || targets.map(m => m.id).join(',') || null });
      persist();
      return r;
    },
    inbox() {
      const p = open();
      p.forEach(m => { if (m.status === 'gesendet') setStatus(m, 'gelesen'); });
      return p.map(m => ({ chat_id: m.id, text: m.text, auswahl: m.meta, zeit: m.time }));
    },
    activity({ tool, ref, text }) {
      return push({ id: id('a'), role: 'activity', tool, ref: ref || null, text: clip(text, 300), time: new Date().toISOString() });
    },
    close() {
      listeners.clear();
      try { fs.rmSync(inboxPath(root), { force: true }); } catch { /* egal */ }
    },
  };
}
