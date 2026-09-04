import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outdir = path.join(root, 'test', 'dist');
fs.rmSync(outdir, { recursive: true, force: true });

await esbuild.build({
  entryPoints: fs
    .readdirSync(path.join(root, 'test'))
    .filter((name) => name.endsWith('.test.ts'))
    .map((name) => path.join(root, 'test', name)),
  outdir,
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node16',
  sourcemap: 'inline',
  logLevel: 'warning',
  // The pure modules only need a handful of `vscode` APIs; the stub supplies them.
  alias: { vscode: path.join(root, 'test', 'vscode-stub.ts') },
});
