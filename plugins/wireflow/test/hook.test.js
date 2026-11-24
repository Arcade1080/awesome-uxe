import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CLI, tempProject } from './helpers.js';

const hook = (root, file) => spawnSync(process.execPath, [CLI, 'hook-validate'], {
  input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Write', cwd: root, tool_input: { file_path: file } }),
  encoding: 'utf8',
});

test('PostToolUse-Hook: Fehler gehen mit Exit 2 an Claude, Hinweise als Kontext', () => {
  const root = tempProject();
  const ok = hook(root, '.wireflow/screens/profil.screen.tsx');
  assert.equal(ok.status, 0);
  assert.equal(ok.stderr, '');

  const f = path.join(root, '.wireflow/screens/profil.screen.tsx');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('<Spacer data-wf="spacer" />', '<div style={{ height: 8 }} />'));
  const bad = hook(root, f);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /HTML-Element <div>/);

  const gap = hook(root, '.wireflow/screens/bestaetigung.screen.tsx');
  assert.equal(gap.status, 0);
  assert.match(JSON.parse(gap.stdout).hookSpecificOutput.additionalContext, /DS-Lücke/);

  fs.writeFileSync(path.join(root, '.wireflow/knowledge/insights.json'), '[{"id": ');
  const json = hook(root, '.wireflow/knowledge/insights.json');
  assert.equal(json.status, 2);
  assert.match(json.stderr, /kein gültiges JSON/);

  const outside = hook(root, 'src/components/SuccessMark.tsx');
  assert.equal(outside.status, 0, 'Dateien außerhalb von .wireflow werden ignoriert');
});

test('SessionStart: doctor --brief liefert Kontext oder schweigt ohne Projekt', () => {
  const root = tempProject();
  const r = spawnSync(process.execPath, [CLI, 'doctor', '--brief'], { env: { ...process.env, CLAUDE_PROJECT_DIR: root, WIREFLOW_ROOT: '' }, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Wireflow-Projekt „Acme Health/);
  const none = spawnSync(process.execPath, [CLI, 'doctor', '--brief'], { env: { ...process.env, CLAUDE_PROJECT_DIR: path.dirname(root), WIREFLOW_ROOT: '' }, cwd: path.dirname(root), encoding: 'utf8' });
  assert.equal(none.status, 0);
  assert.equal(none.stdout, '');
});
