// Storybook als Renderer: Erkennung, Story-Index, Proxy unter dem Ursprung des Canvas,
// WebSockets, Storybook-Brett im Browser – gegen ein nachgebautes Storybook (ohne Abhängigkeiten).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { createRequire } from 'node:module';
import { startCanvas } from '../src/canvas/server.js';
import { storyGroups, normalizeStorybookUrl, findStorybook, storybookStatus } from '../src/core/storybook.js';
import { loadProject } from '../src/core/project.js';
import { tempProject, hasRenderer, EXAMPLE } from './helpers.js';

const INDEX = {
  v: 5,
  entries: {
    'screens-home--default': { type: 'story', id: 'screens-home--default', title: 'Screens/Home', name: 'Default', importPath: './src/Home.stories.tsx', componentPath: './src/Home.tsx', tags: ['dev', 'test'] },
    'screens-home--goal-met': { type: 'story', id: 'screens-home--goal-met', title: 'Screens/Home', name: 'Goal Met', importPath: './src/Home.stories.tsx', componentPath: './src/Home.tsx', tags: ['dev'] },
    'components-button--primary': { type: 'story', id: 'components-button--primary', title: 'Components/Button', name: 'Primary', importPath: './src/Button.stories.tsx', tags: ['dev'] },
    'components-button--docs': { type: 'docs', id: 'components-button--docs', title: 'Components/Button', name: 'Docs', importPath: './src/Button.stories.tsx' },
  },
};

// Nachgebautes Storybook: index.json, iframe.html, Assets und ein WebSocket-Echo.
function fakeStorybook({ script = '' } = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, host: req.headers.host, cookie: req.headers.cookie || null, origin: req.headers.origin || null });
    if (req.url === '/index.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(INDEX)); return; }
    if (req.url.startsWith('/iframe.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><head><title>sb</title></head><body class="sb-main-fullscreen sb-show-main"><div id="storybook-root"></div>${script ? '<script src="/sb.js"></script>' : ''}</body></html>`);
      return;
    }
    if (req.url === '/sb.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(script); return; }
    if (req.url === '/asset.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end('export const ok = 1;'); return; }
    res.writeHead(404);
    res.end();
  });
  const sockets = new Set();
  server.on('upgrade', (req, socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    seen.push({ url: req.url, upgrade: true, host: req.headers.host, cookie: req.headers.cookie || null });
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    socket.on('data', d => socket.write(d));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => { for (const s of sockets) s.destroy(); server.closeAllConnections?.(); server.close(() => r()); }) })));
}

function withStorybook(root, url, screens) {
  const file = path.join(root, '.wireflow', 'project.json');
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  p.storybook = { url, ...(screens ? { screens } : {}) };
  fs.writeFileSync(file, JSON.stringify(p, null, 2));
}

async function login(c) {
  const r = await fetch(c.url, { redirect: 'manual' });
  return { cookie: r.headers.get('set-cookie').split(';')[0], base: `http://127.0.0.1:${c.port}` };
}

// Roher WebSocket-Handshake über den Canvas (ohne Client-Bibliothek).
function upgrade(port, headers) {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1', () => {
      s.write(`GET /storybook-server-channel?token=abc HTTP/1.1\r\n${Object.entries({ host: `127.0.0.1:${port}`, upgrade: 'websocket', connection: 'Upgrade', ...headers }).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
    });
    let buf = '';
    s.on('data', d => {
      buf += d.toString('utf8');
      if (buf.startsWith('HTTP/1.1 101') && buf.includes('\r\n\r\n') && !s.pinged) { s.pinged = true; s.write('ping'); return; }
      if (buf.endsWith('ping') || !buf.startsWith('HTTP/1.1 101')) { s.destroy(); resolve(buf); }
    });
    s.on('error', reject);
    setTimeout(() => { s.destroy(); resolve(buf); }, 2000);
  });
}

test('Storybook: Gruppen, Screens erkennen, nur lokale URLs', async () => {
  const groups = storyGroups(INDEX, { base: 'apps/web' });
  assert.deepEqual(groups.map(g => [g.title, g.screen, g.stories.length]), [['Screens/Home', true, 2], ['Components/Button', false, 1]], 'Docs-Einträge zählen nicht');
  assert.equal(groups[0].file, 'apps/web/src/Home.stories.tsx', 'Pfade relativ zum Projekt');
  assert.deepEqual(groups[0].stories[0].tags, [], 'Standard-Tags werden ausgeblendet');
  const custom = storyGroups(INDEX, { settings: { screens: ['Components/'] } });
  assert.deepEqual(custom.map(g => g.screen), [false, true], 'storybook.screens in project.json hat Vorrang');
  assert.equal(normalizeStorybookUrl('http://localhost:6006/?path=/story/x'), 'http://localhost:6006');
  assert.equal(normalizeStorybookUrl('https://storybook.example.com'), null, 'nur Loopback');
  assert.equal(normalizeStorybookUrl('file:///etc'), null);

  const sb = await fakeStorybook();
  const root = tempProject();
  try {
    // Fremdes Storybook (Dateien gibt es hier nicht) wird beim Suchen übergangen …
    assert.equal(await findStorybook(root, { url: null }, { candidates: [sb.url] }), null);
    // … ein eigenes (Dateien vorhanden) erkannt, auch in einem Unterordner mit .storybook/
    fs.mkdirSync(path.join(root, 'apps', 'web', 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, 'apps', 'web', '.storybook'));
    fs.writeFileSync(path.join(root, 'apps', 'web', 'src', 'Home.stories.tsx'), 'export default {};');
    const found = await findStorybook(root, { url: null }, { candidates: ['http://127.0.0.1:9', sb.url] });
    assert.equal(found.url, sb.url);
    assert.equal(found.base, 'apps/web');
    // Eingestellte URL gilt ohne Prüfung; Status für Claude (storybook_status)
    withStorybook(root, sb.url);
    const st = await storybookStatus(root, loadProject(root));
    assert.equal(st.verbunden, true);
    assert.deepEqual(st.screens, ['Screens/Home']);
    assert.equal(st.stories, 3);
  } finally {
    await sb.close();
  }
});

test('Canvas reicht Storybook unter seinem Ursprung durch: Index, iframe.html mit Skript, WebSocket', async () => {
  const sb = await fakeStorybook();
  const root = tempProject();
  withStorybook(root, sb.url);
  const c = await startCanvas({ root, port: 0 });
  try {
    const { cookie, base } = await login(c);
    const api = await (await fetch(`${base}/api/storybook?refresh=1`, { headers: { cookie } })).json();
    assert.equal(api.status, 'verbunden');
    assert.equal(api.url, sb.url);
    assert.deepEqual(api.groups.map(g => g.title), ['Screens/Home', 'Components/Button']);

    assert.equal((await fetch(`${base}/iframe.html?id=screens-home--default`)).status, 401, 'ohne Token kein Storybook');
    const frame = await fetch(`${base}/iframe.html?viewMode=story&id=screens-home--default`, { headers: { cookie: `${cookie}; theme=dark` } });
    assert.equal(frame.status, 200);
    const html = await frame.text();
    assert.match(html, /<script src="\/__wireflow\/sbframe\.js"><\/script><\/body>/, 'Canvas-Skript eingefügt');
    const hit = sb.seen.find(s => s.url.startsWith('/iframe.html'));
    assert.equal(hit.host, new URL(sb.url).host, 'Host des Storybooks');
    assert.equal(hit.cookie, 'theme=dark', 'Zugangstoken des Canvas bleibt beim Canvas');
    assert.equal(await (await fetch(`${base}/asset.js`, { headers: { cookie } })).text(), 'export const ok = 1;');
    assert.match(await (await fetch(`${base}/__wireflow/sbframe.js`, { headers: { cookie } })).text(), /__wfSb/);

    const file = await fetch(`${base}/api/file?path=.wireflow/screens/suche.screen.tsx`, { headers: { cookie } });
    assert.match((await file.json()).source, /SucheScreen/);
    assert.equal((await fetch(`${base}/api/file?path=../../etc/passwd`, { headers: { cookie } })).status, 400, 'nur Dateien im Projekt');
    assert.equal((await fetch(`${base}/api/file?path=.env`, { headers: { cookie } })).status, 400, 'nur Quelltext');

    const ok = await upgrade(c.port, { cookie });
    assert.match(ok, /^HTTP\/1\.1 101/);
    assert.ok(ok.endsWith('ping'), 'Daten gehen in beide Richtungen');
    assert.equal(sb.seen.find(s => s.upgrade).cookie, null);
    assert.match(await upgrade(c.port, {}), /^HTTP\/1\.1 403/, 'WebSocket nur mit Token');
    assert.match(await upgrade(c.port, { cookie, origin: 'http://evil.example' }), /^HTTP\/1\.1 403/, 'und nur vom eigenen Ursprung');

    // Storybook beendet: Canvas meldet es und gibt einen Hinweis.
    await sb.close();
    const off = await (await fetch(`${base}/api/storybook?refresh=1`, { headers: { cookie } })).json();
    assert.equal(off.status, 'aus');
    assert.ok(off.hint.length > 20);
  } finally {
    await c.close();
    await sb.close().catch(() => {});
  }
});

let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* optional */ }

// Eine Story mit echtem React und der Preview-API, wie Storybook sie im iframe bereitstellt.
const STORY = `
import { createRoot } from 'react-dom/client';
function Button({ label, variant }) { return <button className={'b-' + variant} style={{ padding: 8 }}>{label}</button>; }
function Card({ title, children }) { return <section style={{ padding: 16, background: '#eef' }}><h2>{title}</h2>{children}</section>; }
function Home({ name, variant }) { return <main><Card title={'Hallo ' + name}><Button label="Los" variant={variant} /><Button label="Später" variant="ghost" /></Card></main>; }
const id = new URLSearchParams(location.search).get('id');
const initialArgs = { name: 'Biscuit', variant: 'primary' };
let args = { ...initialArgs };
const on = {};
const root = createRoot(document.getElementById('storybook-root'));
const render = () => root.render(<Home {...args} />);
window.__STORYBOOK_ADDONS_CHANNEL__ = {
  on(ev, fn) { (on[ev] = on[ev] || []).push(fn); },
  emit(ev, d) {
    if (ev === 'updateStoryArgs') args = { ...args, ...d.updatedArgs };
    if (ev === 'resetStoryArgs') args = { ...initialArgs };
    render();
    (on.storyArgsUpdated || []).forEach(fn => fn({ storyId: id, args }));
  },
};
window.__STORYBOOK_PREVIEW__ = { storyStoreValue: {
  loadStory: async () => ({ title: 'Screens/Home', name: 'Default', parameters: { layout: 'fullscreen' }, initialArgs,
    argTypes: { name: { type: { name: 'string' }, control: { type: 'text' } }, variant: { type: { name: 'enum', value: ['primary', 'secondary', 'ghost'] }, control: { type: 'radio' }, options: ['primary', 'secondary', 'ghost'] }, onPress: { type: { name: 'function' }, action: 'onPress' } } }),
  args: { get: () => args },
} };
render();
`;

test('Storybook-Brett im Browser: Stories als Frames, Komponentenbaum aus React, Args live, Auswahl für Claude', { skip: (!chromium || !hasRenderer()) && 'Playwright oder React/esbuild fehlt' }, async () => {
  const esbuild = createRequire(path.join(EXAMPLE, 'package.json'))('esbuild');
  const root = tempProject();
  const entry = path.join(root, 'story-entry.jsx');
  fs.writeFileSync(entry, STORY);
  const out = await esbuild.build({ entryPoints: [entry], bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  const sb = await fakeStorybook({ script: out.outputFiles[0].text });
  withStorybook(root, sb.url);
  const c = await startCanvas({ root, port: 0 });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.setDefaultTimeout(8000);
    await page.goto(c.url);
    await page.waitForSelector('#flowSel option[value="__storybook"]', { state: 'attached' });
    await page.selectOption('#flowSel', '__storybook');
    await page.waitForFunction(() => document.querySelectorAll('.node.story iframe').length === 2);
    assert.equal(await page.$$eval('.node.story.comp', x => x.length), 0, 'Komponenten-Stories erst auf Wunsch');

    // Story wählen: Komponentenbaum kommt live aus React (ohne Storybook-Hüllen)
    await page.click('#left .sbtree button:has-text("Default")');
    await page.waitForFunction(() => document.querySelectorAll('#left .tree:not(.sbtree) .nm').length >= 4);
    assert.deepEqual(await page.$$eval('#left .tree:not(.sbtree) .nm', x => x.map(e => e.textContent)), ['Home', 'Card', 'Button', 'Button']);

    // Args live ändern – die Story rendert neu, „In Code übernehmen“ erscheint
    await page.fill('#right [data-key="sbarg:name"]', 'Rex');
    await page.press('#right [data-key="sbarg:name"]', 'Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('.node.story iframe')].some(f => /Hallo Rex/.test(f.contentDocument?.body?.textContent || '')));
    await page.click('#right .segctl[aria-label="variant"] button:has-text("ghost")');
    await page.waitForFunction(() => [...document.querySelectorAll('.node.story iframe')].some(f => f.contentDocument?.querySelectorAll('.b-ghost').length === 2));
    assert.ok(await page.$('#right button:has-text("In Code übernehmen")'));
    assert.equal(await page.$('#right [data-key="sbarg:onPress"]'), null, 'Aktionen sind keine Controls');

    // Element wählen: Props wie gerendert, Quelle und Auswahl für Claude
    await page.click('#left .tree:not(.sbtree) button:has-text("Button") >> nth=0');
    await page.waitForSelector('#right .ihead h2:has-text("Button")');
    const props = await page.$$eval('#right .row', r => r.map(x => x.textContent));
    assert.ok(props.some(p => /label.*"Los"/.test(p)), props.join(' | '));
    await page.waitForFunction(() => document.querySelector('.ov .sb') !== null);
    await page.waitForTimeout(400);
    const state = JSON.parse(fs.readFileSync(path.join(root, '.wireflow', '.canvas-state.json'), 'utf8')).auswahl;
    assert.equal(state.flow, 'storybook');
    assert.equal(state.story.id, 'screens-home--default');
    assert.equal(state.story.datei, 'src/Home.stories.tsx');
    assert.equal(state.element.komponente, 'Button');
    assert.equal(state.story.args.name, 'Rex');

    // Style-Reiter liest Werte aus dem Frame (gleicher Ursprung)
    await page.click('#right .elseg button:has-text("Style")');
    await page.waitForSelector('#right .look');

    // Komponenten-Story auf den Canvas holen und wieder entfernen
    await page.click('#left .sbtree button:has-text("Primary")');
    await page.waitForFunction(() => document.querySelectorAll('.node.story.comp iframe').length === 1);
    await page.click('#left .sbtree .unpin');
    await page.waitForFunction(() => document.querySelectorAll('.node.story.comp').length === 0);

    // Prototyp braucht einen Flow – das Brett wechselt verständlich
    await page.keyboard.press('p');
    await page.waitForSelector('.toast:has-text("Prototyp")');
    assert.notEqual(await page.$eval('#flowSel', s => s.value), '__storybook');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await c.close();
    await sb.close();
  }
});
