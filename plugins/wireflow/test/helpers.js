// Testhilfen: Kopie des Beispielprojekts in einem temporären Verzeichnis.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EXAMPLE = path.join(PLUGIN, 'examples', 'acme-health');
export const CLI = path.join(PLUGIN, 'bin', 'wireflow');

const temps = [];
process.on('exit', () => temps.forEach(d => fs.rmSync(d, { recursive: true, force: true })));

// Kopiert das Beispiel; node_modules wird verlinkt, @acme/ui zeigt auf die Kopie (wie ein Workspace).
export function tempProject() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wireflow-test-')));
  temps.push(dir);
  fs.cpSync(EXAMPLE, dir, { recursive: true, filter: src => !src.split(path.sep).includes('node_modules') });
  const nm = path.join(EXAMPLE, 'node_modules');
  const tnm = path.join(dir, 'node_modules');
  fs.mkdirSync(path.join(tnm, '@acme'), { recursive: true });
  fs.symlinkSync(path.join(dir, 'packages', 'acme-ui'), path.join(tnm, '@acme', 'ui'), 'dir');
  if (fs.existsSync(nm)) {
    for (const e of fs.readdirSync(nm)) if (e !== '@acme') fs.symlinkSync(path.join(nm, e), path.join(tnm, e));
  }
  return dir;
}

export const hasRenderer = () => fs.existsSync(path.join(EXAMPLE, 'node_modules', 'esbuild')) && fs.existsSync(path.join(EXAMPLE, 'node_modules', 'react-dom'));

export const read = (root, rel) => fs.readFileSync(path.join(root, '.wireflow', rel), 'utf8');
export const ids = src => [...src.matchAll(/data-wf="([\w-]+)"/g)].map(m => m[1]);
