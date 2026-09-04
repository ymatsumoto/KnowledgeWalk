import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

/** Copy KaTeX's stylesheet and fonts into media/ so the webview can load them locally. */
function copyKatexAssets() {
  const src = path.join(root, 'node_modules', 'katex', 'dist');
  const dest = path.join(root, 'media', 'katex');
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(path.join(src, 'katex.min.css'), path.join(dest, 'katex.min.css'));
  fs.cpSync(path.join(src, 'fonts'), path.join(dest, 'fonts'), { recursive: true });
}

const shared = {
  bundle: true,
  minify: production,
  sourcemap: production ? false : 'inline',
  logLevel: 'info',
  legalComments: 'none',
};

const targets = [
  {
    ...shared,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['vscode'],
  },
  {
    ...shared,
    entryPoints: ['webview/main.ts'],
    outfile: 'dist/webview.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
  },
  {
    ...shared,
    entryPoints: ['webview/mermaid.ts'],
    outfile: 'dist/mermaid.js',
    platform: 'browser',
    format: 'iife',
    globalName: 'MdxMermaid',
    target: 'es2020',
  },
];

copyKatexAssets();

if (watch) {
  const contexts = await Promise.all(targets.map((t) => esbuild.context(t)));
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('[esbuild] watching...');
} else {
  await Promise.all(targets.map((t) => esbuild.build(t)));
  console.log('[esbuild] build complete');
}
