// Läuft in jedem gerenderten Screen (iframe): meldet Lage und Größe aller Elemente
// mit data-wf an den Canvas, zeigt Fehler und im Prototyp Hotspot-Hinweise.
(() => {
  const W = window.__WF__ || {};
  const post = msg => {
    if (window.parent === window) return;
    window.parent.postMessage({ wf: 1, ref: W.ref, ...msg }, location.origin);
  };
  let failed = false;

  window.__wfError = message => {
    failed = true;
    const pre = document.createElement('pre');
    pre.className = 'wf-error';
    pre.textContent = String(message);
    document.body.replaceChildren(pre);
    post({ type: 'error', message: String(message) });
    report();
  };
  window.addEventListener('error', e => post({ type: 'error', message: String(e.message || e.error) }));

  function boxes() {
    const out = {};
    document.querySelectorAll('[data-wf]').forEach(el => {
      const id = el.getAttribute('data-wf');
      if (out[id]) return;
      const r = el.getBoundingClientRect();
      if (r.width || r.height) out[id] = [Math.round(r.left + scrollX), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)];
    });
    return out;
  }

  // setTimeout statt requestAnimationFrame: läuft auch in (noch) unsichtbaren iframes.
  let timer = 0;
  let sent = false;
  function report() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const height = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
      post({ type: sent ? 'layout' : 'ready', boxes: boxes(), height, failed });
      sent = true;
    }, sent ? 40 : 16);
  }

  const start = () => {
    new MutationObserver(report).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    report();
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
  addEventListener('load', report);
  addEventListener('resize', report);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(report);

  // Prototyp: Klick ins Leere zeigt, wo es weitergeht (Hotspot-Hinweise).
  let hotspots = [];
  function flash() {
    const layer = document.createElement('div');
    layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483647';
    for (const id of hotspots) {
      const el = document.querySelector(`[data-wf="${CSS.escape(id)}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const d = document.createElement('div');
      d.style.cssText = `position:absolute;left:${r.left + scrollX - 3}px;top:${r.top + scrollY - 3}px;width:${r.width + 6}px;height:${r.height + 6}px;border-radius:8px;background:rgb(47 107 255/.22);outline:2px solid rgb(47 107 255/.75);transition:opacity .5s ease .45s`;
      layer.append(d);
    }
    document.body.append(layer);
    requestAnimationFrame(() => requestAnimationFrame(() => { for (const d of layer.children) d.style.opacity = '0'; }));
    setTimeout(() => layer.remove(), 1100);
  }
  addEventListener('message', e => {
    if (e.origin !== location.origin || !e.data || e.data.wf !== 1) return;
    if (e.data.type === 'hotspots') hotspots = e.data.ids || [];
    if (e.data.type === 'flash') flash();
  });
  if (W.ui === 'prototype') {
    document.addEventListener('click', e => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t || !t.closest('button,a,input,select,textarea,label,[role=button],[tabindex]')) flash();
    }, true);
  }
})();
