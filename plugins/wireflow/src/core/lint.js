// Regeln für Screen-Module: nur DS-Komponenten, nur Props und Tokens, Richtlinien des DS.
import { walk, getAttr } from './jsx.js';
import { components } from './ds.js';

export function lintScreen(screen, model) {
  const res = { errors: [], warnings: [], infos: [], score: { ds: 0, total: 0, pct: 100 } };
  if (screen.error || !screen.tree) { res.errors.push({ msg: screen.error || 'Screen konnte nicht gelesen werden' }); res.score.pct = 0; return res; }
  const comps = components(model.manifest);
  const pkg = model.manifest.package;
  const allowed = model.project.screens?.allowedImports || [];
  for (const m of screen.source.matchAll(/^import\s+(?:type\s+)?[^'"\n]*?from\s*['"]([^'"]+)['"]/gm)) {
    const src = m[1];
    const ok = src === pkg || src === '@wireflow/runtime' || src.startsWith('../fixtures') || allowed.some(a => src.startsWith(a));
    if (!ok) res.warnings.push({ msg: `Import „${src}“ liegt außerhalb der Regeln für Screen-Module.` });
  }
  walk(screen.tree, n => {
    const id = getAttr(n, 'data-wf');
    const at = id ? ` (${id})` : '';
    res.score.total++;
    if (/^[a-z]/.test(n.name)) {
      res.errors.push({ el: id, msg: `HTML-Element <${n.name}>${at}: In Screen-Modulen sind nur Komponenten des Design Systems erlaubt.` });
      return;
    }
    const spec = comps.get(n.name) || comps.get(n.name.split('.')[0]);
    if (!spec) res.warnings.push({ el: id, gap: true, msg: `<${n.name}>${at} ist keine Komponente aus ${model.manifest.name || 'dem Design System'} – DS-Lücke.` });
    else {
      res.score.ds++;
      if (spec.status === 'deprecated') res.warnings.push({ el: id, msg: `<${n.name}>${at} ist veraltet${spec.replacedBy ? ` – stattdessen ${spec.replacedBy}` : ''}.` });
      if (spec.status === 'experimental' && !model.project.screens?.allowExperimental) res.warnings.push({ el: id, msg: `<${n.name}>${at} ist experimentell.` });
    }
    if (!id) res.infos.push({ msg: `<${n.name}> hat keine data-wf-ID; der Canvas vergibt sie beim Speichern.` });
    for (const a of n.attrs) {
      if (a.name === 'style' || a.name === 'className') { res.errors.push({ el: id, msg: `„${a.name}“${at} ist nicht erlaubt – Gestaltung nur über Props und Tokens.` }); continue; }
      if (!spec || !a.name || a.name === 'key' || /^(data|aria)-/.test(a.name)) continue;
      const ps = spec.props?.[a.name];
      if (!ps) { res.warnings.push({ el: id, msg: `Prop „${a.name}“ gibt es an <${n.name}> nicht.` }); continue; }
      if (ps.enum && a.kind === 'str' && !ps.enum.includes(a.raw)) res.errors.push({ el: id, msg: `<${n.name}> ${a.name}="${a.raw}" ist nicht erlaubt (erlaubt: ${ps.enum.join(', ')}).` });
      if (ps.type === 'token' && a.kind === 'str' && !/^[a-z]+(\.[\w-]+)+$/.test(a.raw)) res.errors.push({ el: id, msg: `<${n.name}> ${a.name}="${a.raw}" ist ein freier Wert – bitte ein Token verwenden.` });
    }
    if (spec) {
      for (const [k, ps] of Object.entries(spec.props || {})) {
        const has = n.attrs.some(a => a.name === k) || (k === 'children' && n.children.length > 0);
        if (ps.required && !has) res.errors.push({ el: id, msg: `<${n.name}>${at}: Pflicht-Prop „${k}“ fehlt.` });
      }
    }
    n.children.forEach(c => {
      if (c.type === 'expr' && !/^\/\*[\s\S]*\*\/$/.test(c.raw) && !/^[\w$.]+$/.test(c.raw)) res.infos.push({ el: id, msg: `Code-Block in <${n.name}>${at}: wird angezeigt, aber auf dem Canvas nicht strukturell bearbeitet.` });
    });
  });
  for (const c of model.manifest.components || []) {
    for (const r of c.rules || []) {
      if (r.type !== 'max-per-screen') continue;
      let count = 0;
      walk(screen.tree, n => { if (n.name === c.name && Object.entries(r.where || {}).every(([k, v]) => getAttr(n, k) === v)) count++; });
      if (count > r.max) res.warnings.push({ rule: true, msg: (r.message || `Höchstens ${r.max}× ${c.name} pro Screen.`).replace('{n}', count) });
    }
  }
  res.score.pct = res.score.total ? Math.round((res.score.ds / res.score.total) * 100) : 100;
  return res;
}
