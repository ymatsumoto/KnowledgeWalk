/**
 * Drop the freshly packaged .vsix into a dev container's extensions folder, replacing any
 * older build, so the next attach installs it. See docs/devcontainer.md.
 *
 * The folder is KW_DEPLOY_DIR, or `../.devcontainer/extensions` next to this repository
 * when that exists — the layout where the extension is developed inside the workspace the
 * container mounts.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const vsix = path.join(root, `${manifest.name}-${manifest.version}.vsix`);
const target = process.env.KW_DEPLOY_DIR
  ? path.resolve(process.env.KW_DEPLOY_DIR)
  : path.join(path.dirname(root), '.devcontainer', 'extensions');

if (!fs.existsSync(vsix)) {
  throw new Error(`${path.basename(vsix)} is missing; run \`npm run package\` first.`);
}
if (!fs.existsSync(target)) {
  throw new Error(
    `${target} does not exist. Set KW_DEPLOY_DIR to the dev container's extensions folder.`
  );
}

for (const stale of fs.readdirSync(target)) {
  if (stale.startsWith(`${manifest.name}-`) && stale.endsWith('.vsix')) {
    fs.rmSync(path.join(target, stale));
  }
}
fs.copyFileSync(vsix, path.join(target, path.basename(vsix)));
console.log(`Copied ${path.basename(vsix)} to ${target}`);
console.log('It installs on the next devcontainer attach; reload the window to pick it up now.');
