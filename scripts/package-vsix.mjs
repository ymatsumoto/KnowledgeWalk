/**
 * Build an installable .vsix.
 *
 * `@vscode/vsce` needs Node >= 18 (its undici dependency uses WHATWG globals that Node 16
 * does not have), so on older toolchains this script assembles the package directly. A
 * .vsix is an OPC zip: `[Content_Types].xml`, `extension.vsixmanifest`, and the extension
 * itself under `extension/`.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const staging = path.join(root, '.vsix-staging');
const vsixName = `${manifest.name}-${manifest.version}.vsix`;

/** Files and directories that make up the shipped extension. */
const CONTENTS = ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'dist', 'media', 'l10n'];

function escapeXml(value) {
  return value.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

function vsixManifest() {
  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${escapeXml(manifest.name)}" Version="${escapeXml(
    manifest.version
  )}" Publisher="${escapeXml(manifest.publisher)}" />
    <DisplayName>${escapeXml(manifest.displayName)}</DisplayName>
    <Description xml:space="preserve">${escapeXml(manifest.description)}</Description>
    <Tags>markdown,preview,documentation</Tags>
    <Categories>${escapeXml((manifest.categories ?? ['Other']).join(','))}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${escapeXml(
        manifest.engines.vscode
      )}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true" />
  </Assets>
</PackageManifest>
`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="css" ContentType="text/css" />
  <Default Extension="md" ContentType="text/markdown" />
  <Default Extension="png" ContentType="image/png" />
  <Default Extension="svg" ContentType="image/svg+xml" />
  <Default Extension="woff" ContentType="font/woff" />
  <Default Extension="woff2" ContentType="font/woff2" />
  <Default Extension="ttf" ContentType="font/ttf" />
  <Default Extension="vsixmanifest" ContentType="text/xml" />
  <Default Extension="txt" ContentType="text/plain" />
  <Default Extension="LICENSE" ContentType="text/plain" />
</Types>
`;

fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(path.join(staging, 'extension'), { recursive: true });

for (const entry of CONTENTS) {
  const source = path.join(root, entry);
  if (!fs.existsSync(source)) {
    throw new Error(`Missing ${entry}. Run \`node esbuild.mjs --production\` first.`);
  }
  fs.cpSync(source, path.join(staging, 'extension', entry), { recursive: true });
}

fs.writeFileSync(path.join(staging, 'extension.vsixmanifest'), vsixManifest());
fs.writeFileSync(path.join(staging, '[Content_Types].xml'), CONTENT_TYPES);

const output = path.join(root, vsixName);
fs.rmSync(output, { force: true });
execFileSync('zip', ['-r', '-q', '-X', output, '[Content_Types].xml', 'extension.vsixmanifest', 'extension'], {
  cwd: staging,
});
fs.rmSync(staging, { recursive: true, force: true });

const size = (fs.statSync(output).size / 1024 / 1024).toFixed(2);
console.log(`Wrote ${vsixName} (${size} MB)`);
console.log(`Install with: code --install-extension ${vsixName}`);
