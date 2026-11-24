import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { startCanvas } from '../src/canvas/server.js';
import { tempProject, hasRenderer, read } from './helpers.js';

async function login(c) {
  const r = await fetch(c.url, { redirect: 'manual' });
  assert.equal(r.status, 302);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  assert.match(cookie, new RegExp(`^wf_${c.port}=`));
  return { cookie, base: `http://127.0.0.1:${c.port}` };
}

function events(base, cookie) {
  const ctrl = new AbortController();
  const seen = [];
  let wake = null;
  fetch(`${base}/api/events`, { headers: { cookie }, signal: ctrl.signal }).then(async r => {
    const dec = new TextDecoder();
    let buf = '';
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: (\w+)/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (ev) { seen.push({ ev, data: data ? JSON.parse(data) : null }); wake?.(); }
      }
    }
  }).catch(() => {});
  const next = (ev, ms = 3000) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`kein Ereignis ${ev}`)), ms);
    const check = () => {
      const i = seen.findIndex(s => s.ev === ev);
      if (i >= 0) { clearTimeout(t); resolve(seen.splice(i, 1)[0].data); } else wake = check;
    };
    check();
  });
  return { next, close: () => ctrl.abort() };
}

test('Canvas-Server: Zugang nur mit Token, Projekt-API, Operationen, Live-Ereignisse', async () => {
  const root = tempProject();
  const c = await startCanvas({ root, port: 0 });
  try {
    const no = await fetch(`http://127.0.0.1:${c.port}/api/project`);
    assert.equal(no.status, 401);
    const { cookie, base } = await login(c);
    // fetch erlaubt keinen eigenen Host-Header – deshalb node:http
    const evil = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: c.port, path: '/api/project', headers: { cookie, host: `evil.example:${c.port}` } }, r => { r.resume(); resolve(r.statusCode); }).on('error', reject);
    });
    assert.equal(evil, 403, 'fremder Host (DNS-Rebinding) wird abgewiesen');

    const p = await (await fetch(`${base}/api/project`, { headers: { cookie } })).json();
    assert.equal(p.flows[0].id, 'flw_buchung');
    assert.equal(p.ds.components.length, 14);
    assert.equal(p.ds.components.find(x => x.name === 'Button').handler, 'onPress');
    assert.equal(p.screens['screens/profil.screen.tsx'].tree.children[0].id, 'ab');

    const sse = events(base, cookie);
    await sse.next('hello');
    const op = await fetch(`${base}/api/op`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', 'x-wf-client': 'test' },
      body: JSON.stringify({ ref: 'screens/profil.screen.tsx', op: 'setProp', id: 'btn_weiter', name: 'variant', value: 'secondary' }),
    });
    const res = await op.json();
    assert.equal(res.ok, true);
    assert.deepEqual(res.files, ['.wireflow/screens/profil.screen.tsx']);
    const ev = await sse.next('change');
    assert.equal(ev.by, 'test');
    assert.match(read(root, 'screens/profil.screen.tsx'), /data-wf="btn_weiter" variant="secondary"/);

    // Änderung von außen (Editor oder Claude) wird gemeldet
    const f = path.join(root, '.wireflow/screens/suche.screen.tsx');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('Ärzt:innen finden', 'Praxen finden'));
    const ext = await sse.next('change', 4000);
    assert.equal(ext.by, null);
    assert.ok(ext.files.includes('.wireflow/screens/suche.screen.tsx'));

    const flow = await (await fetch(`${base}/api/flow`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ flow: 'flw_buchung', op: 'moveNode', id: 'scr_suche', x: -40, y: 20 }),
    })).json();
    assert.equal(flow.ok, true);

    const sel = await fetch(`${base}/api/selection`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ selection: { knoten: 'scr_profil', element: 'btn_weiter' } }) });
    assert.equal(sel.status, 200);
    assert.equal(JSON.parse(read(root, '.canvas-state.json')).auswahl.element, 'btn_weiter');

    const cross = await fetch(`${base}/api/undo`, { method: 'POST', headers: { cookie, origin: 'http://evil.example' } });
    assert.equal(cross.status, 403, 'fremder Ursprung darf nichts ändern');
    sse.close();
  } finally {
    await c.close();
  }
});

test('Canvas-Server: rendert Screens mit dem esbuild des Projekts', { skip: !hasRenderer() && 'Beispiel ohne node_modules (npm install im Beispiel)' }, async () => {
  const root = tempProject();
  const c = await startCanvas({ root, port: 0 });
  try {
    const { cookie, base } = await login(c);
    const html = await (await fetch(`${base}/render?ref=screens/profil.screen.tsx&mode=wireframe`, { headers: { cookie } })).text();
    assert.match(html, /<html lang="de" data-wf-mode="wireframe">/);
    assert.match(html, /<script src="\/bundle\.js\?v=\d+"><\/script>/);
    const js = await (await fetch(`${base}/bundle.js`, { headers: { cookie } })).text();
    assert.match(js, /ProfilTermineScreen/);
    assert.match(js, /"screens\/bestaetigung\.screen\.tsx"/);
    const css = await (await fetch(`${base}/bundle.css`, { headers: { cookie } })).text();
    assert.match(css, /\.acme-btn--primary/);

    // Ein kaputter Screen bricht nur sich selbst, nicht die anderen.
    fs.writeFileSync(path.join(root, '.wireflow/screens/login.screen.tsx'), "import { Page } from '@acme/ui';\nimport { Nope } from './gibt-es-nicht';\nexport function LoginScreen() {\n  return (\n    <Page data-wf=\"p\"><Nope /></Page>\n  );\n}\n");
    await new Promise(r => setTimeout(r, 400));
    const broken = await (await fetch(`${base}/render?ref=screens/login.screen.tsx`, { headers: { cookie } })).text();
    assert.match(broken, /__wfError\(/);
    assert.match(broken, /gibt-es-nicht/);
    const fine = await (await fetch(`${base}/render?ref=screens/profil.screen.tsx`, { headers: { cookie } })).text();
    assert.doesNotMatch(fine, /__wfError\(/);
  } finally {
    await c.close();
  }
});

// Browser-Rauchtest, nur wenn Playwright verfügbar ist.
let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* optional */ }

test('Canvas im Browser: Screens rendern, Element auswählen, Prop ändern', { skip: (!chromium || !hasRenderer()) && 'Playwright oder Renderer fehlt' }, async () => {
  const root = tempProject();
  const c = await startCanvas({ root, port: 0 });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(c.url);
    await page.waitForFunction(() => document.querySelectorAll('.node.scr').length === 6);
    await page.waitForFunction(() => [...document.querySelectorAll('.node.scr iframe')].every(f => f.contentDocument?.querySelector('[data-wf]')), null, { timeout: 15000 });
    const label = await page.evaluate(() => document.querySelector('.node[data-node="scr_profil"] iframe').contentDocument.querySelector('[data-wf="btn_weiter"]').textContent);
    assert.equal(label, 'Weiter', 'echte Komponente gerendert');
    await page.click('#left .tree button:has-text("Profil & Termine")');
    await page.click('#left .tree button:has-text("Button")');
    await page.waitForSelector('#right .segctl[aria-label="variant"]');
    await page.click('#right .segctl[aria-label="variant"] button:has-text("ghost")');
    await page.waitForFunction(() => document.querySelector('.node[data-node="scr_profil"] iframe:not(.loading)')?.contentDocument?.querySelector('.acme-btn--ghost'), null, { timeout: 10000 });
    assert.match(read(root, 'screens/profil.screen.tsx'), /variant="ghost"/);

    // Style: Tokens aus dem Rendering, Kontrast, Änderungsliste mit Rückgängig je Eintrag
    await page.click('#right .elseg button:has-text("Style")');
    await page.waitForFunction(() => [...document.querySelectorAll('#right .look .tok')].some(t => t.textContent === 'font.family.base'), null, { timeout: 10000 });
    const tokens = await page.$$eval('#right .look .tok', t => t.map(x => x.textContent));
    assert.ok(tokens.includes('radius.md'), tokens.join(','));
    assert.match(await page.textContent('#right .contrast'), /Kontrast [\d,]+ : 1/);
    await page.waitForSelector('#right .changes li');
    await page.click('#right .changes li button.reset');
    await page.waitForFunction(() => document.querySelector('.node[data-node="scr_profil"] iframe:not(.loading)')?.contentDocument?.querySelector('.acme-btn--primary'), null, { timeout: 10000 });
    assert.doesNotMatch(read(root, 'screens/profil.screen.tsx'), /variant="ghost"/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await c.close();
  }
});
