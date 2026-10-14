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

/**
 * Write media/mdexplorer.schema.json, the schema of `.mdexplorer.yaml`, from the schema
 * of the `mdExplorer.frontMatterDisplay` setting in package.json — one definition for
 * both, so the YAML file and settings.json always accept the same thing. The Red Hat
 * YAML extension picks it up through `contributes.yamlValidation`.
 */
function writeConfigSchema() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const { default: _default, ...display } =
    manifest.contributes.configuration.properties['mdExplorer.frontMatterDisplay'];
  const schema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: '.mdexplorer.yaml',
    description: 'Per-wiki mdExplorer settings, placed at the wiki root.',
    type: 'object',
    additionalProperties: false,
    properties: { frontMatter: display },
  };
  fs.mkdirSync(path.join(root, 'media'), { recursive: true });
  fs.writeFileSync(path.join(root, 'media', 'mdexplorer.schema.json'), `${JSON.stringify(schema, null, 2)}\n`);
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
writeConfigSchema();

if (watch) {
  const contexts = await Promise.all(targets.map((t) => esbuild.context(t)));
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('[esbuild] watching...');
} else {
  await Promise.all(targets.map((t) => esbuild.build(t)));
  console.log('[esbuild] build complete');
}
