/**
 * Drop the freshly packaged .vsix into the devcontainer's extensions folder, replacing
 * any older build, so the next attach installs it.
 *
 * The devcontainer definition lives one level up from this project in the same bind
 * mounted workspace, which is why no download or registry is involved.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const vsix = path.join(root, `${manifest.name}-${manifest.version}.vsix`);
const target = path.join(path.dirname(root), '.devcontainer', 'extensions');

if (!fs.existsSync(vsix)) {
  throw new Error(`${path.basename(vsix)} is missing; run \`npm run package\` first.`);
}
if (!fs.existsSync(target)) {
  throw new Error(`${target} does not exist — is this the expected devcontainer layout?`);
}

for (const stale of fs.readdirSync(target)) {
  if (stale.startsWith(`${manifest.name}-`) && stale.endsWith('.vsix')) {
    fs.rmSync(path.join(target, stale));
  }
}
fs.copyFileSync(vsix, path.join(target, path.basename(vsix)));
console.log(`Copied ${path.basename(vsix)} to ${target}`);
console.log('It installs on the next devcontainer attach; reload the window to pick it up now.');
