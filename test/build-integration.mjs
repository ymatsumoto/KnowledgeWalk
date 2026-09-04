import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outdir = path.join(root, 'test', 'integration-dist');
fs.rmSync(outdir, { recursive: true, force: true });

// Runs inside the extension host, so `vscode` stays external and the format is CJS.
await esbuild.build({
  entryPoints: [path.join(root, 'test', 'integration', 'index.ts')],
  outfile: path.join(outdir, 'index.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  sourcemap: 'inline',
  logLevel: 'warning',
});
