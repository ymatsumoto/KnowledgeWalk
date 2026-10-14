import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Uri, __setFiles, __setStatPaths, __setWorkspaceFolders } from 'vscode';
import { WikiLinkIndex } from '../src/wikiIndex';
import { OkfService } from '../src/okf/service';

const SAMPLES = path.resolve(__dirname, '..', '..', 'samples');
const HANDBOOK = path.join(SAMPLES, 'okf', 'handbook');
const BUNDLE = path.join(HANDBOOK, 'wiki');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const ALL = walk(SAMPLES).filter((p) => /\.(md|pdf|png)$/.test(p));
__setWorkspaceFolders([SAMPLES]);
__setFiles(ALL);
__setStatPaths([]);

const index = new WikiLinkIndex();
const service = new OkfService(index);

async function prepare(rel: string) {
  const file = path.join(BUNDLE, rel);
  return service.prepare(Uri.file(file), fs.readFileSync(file, 'utf8'));
}

test('root: names the wiki root, and the OKF bundle is found beneath it', async () => {
  const prepared = await prepare('decisions/read-replicas.md');
  assert.equal(prepared.roots.wikiRoot.path, HANDBOOK);
  assert.equal(prepared.roots.bundleRoot.path, BUNDLE);
  assert.equal(prepared.roots.okfVersion, '0.2');
  assert.equal(prepared.frontMatter?.type, 'decision');
});

test('a document outside any bundle uses its wiki root for both', async () => {
  const file = path.join(HANDBOOK, 'notes', 'dup.md');
  const prepared = await service.prepare(Uri.file(file), fs.readFileSync(file, 'utf8'));
  assert.equal(prepared.roots.wikiRoot.path, HANDBOOK);
  assert.equal(prepared.roots.bundleRoot.path, HANDBOOK);
  assert.equal(prepared.roots.okfVersion, undefined);
});

test('a document with no root: and no bundle falls back to the workspace folder', async () => {
  const file = path.join(SAMPLES, 'guide.md');
  const prepared = await service.prepare(Uri.file(file), fs.readFileSync(file, 'utf8'));
  assert.equal(prepared.roots.wikiRoot.path, SAMPLES);
  assert.equal(prepared.roots.bundleRoot.path, SAMPLES);
});

test('indexed files exist without a stat; others are checked on disk once', async () => {
  __setStatPaths(['/srv/shared/capacity-2020.md']);
  try {
    const prepared = await prepare('sources/old-capacity-report.md');
    assert.equal(prepared.exists(path.join(BUNDLE, 'incidents', 'db-outage.md')), true);
    assert.equal(prepared.exists('/srv/shared/capacity-2020.md'), true);
    assert.equal(prepared.exists(path.join(BUNDLE, 'nope.md')), false);
  } finally {
    __setStatPaths([]);
  }
});

test('the wiki root .knowledgewalk.yaml is layered over the settings, then byType', async () => {
  const incident = await prepare('incidents/db-outage.md');
  assert.equal(incident.display.fields.priority?.as, 'badge');
  assert.equal(incident.display.fields.priority?.colors?.high, 'red');
  assert.deepEqual(incident.display.header, ['type', 'status', 'trust', 'generated', 'priority', 'phase']);

  const file = path.join(BUNDLE, 'incidents', 'db-outage.md');
  const withUser = await service.prepare(Uri.file(file), fs.readFileSync(file, 'utf8'), {
    display: { fields: { impact: { as: 'badge' }, priority: { as: 'text' } } },
  });
  assert.equal(withUser.display.fields.impact?.as, 'badge');
  // The wiki's own file wins over the user's setting.
  assert.equal(withUser.display.fields.priority?.as, 'badge');
});

test('a document outside a configured wiki gets the defaults', async () => {
  const file = path.join(SAMPLES, 'guide.md');
  const prepared = await service.prepare(Uri.file(file), fs.readFileSync(file, 'utf8'));
  assert.equal(prepared.display.fields.priority, undefined);
});

test('the key naming the wiki root is configurable, and hidden from the card', async () => {
  const file = path.join(BUNDLE, 'notes', 'custom-root.md');
  const text = '---\ntype: note\nwiki_root: handbook\nroot: not-a-directory\n---\n\n# x\n';
  const custom = await service.prepare(Uri.file(file), text, { rootKey: 'wiki_root' });
  assert.equal(custom.roots.wikiRoot.path, HANDBOOK);
  assert.ok(custom.display.hidden.includes('wiki_root'));
  // `root` is ordinary data under another key name.
  assert.ok(!custom.display.hidden.includes('root'));

  const standard = await service.prepare(Uri.file(file), text);
  // `root: not-a-directory` names no ancestor, so the default key falls back to the
  // workspace folder.
  assert.equal(standard.roots.wikiRoot.path, SAMPLES);
  assert.ok(standard.display.hidden.includes('root'));
});

test('without okf_version, the bundle root is the top of the run of index.md files', async () => {
  // Shaped like the bundles OKF ships: an index.md in every directory, none declaring
  // okf_version.
  const ws = '/virtual/okf';
  const files = [
    `${ws}/README.md`,
    `${ws}/bundles/acme/index.md`,
    `${ws}/bundles/acme/computations/index.md`,
    `${ws}/bundles/acme/computations/margin.md`,
    `${ws}/bundles/acme/policies/index.md`,
    `${ws}/bundles/acme/policies/standard.md`,
    `${ws}/bundles/acme/notes/loose.md`,
  ];
  __setWorkspaceFolders([ws]);
  __setFiles(files);
  try {
    const virtualService = new OkfService(new WikiLinkIndex());
    const text = '---\ntype: Attested Computation\nsources:\n  - { id: std, resource: policies/standard.md }\n---\n';
    const prepared = await virtualService.prepare(Uri.file(`${ws}/bundles/acme/computations/margin.md`), text);
    // `bundles/` has no index.md, so the run stops at `acme/`.
    assert.equal(prepared.roots.bundleRoot.path, `${ws}/bundles/acme`);
    assert.equal(prepared.roots.okfVersion, undefined);
    assert.equal(prepared.exists(`${ws}/bundles/acme/policies/standard.md`), true);

    // A directory without an index.md breaks the run at once: no bundle is inferred.
    const loose = await virtualService.prepare(Uri.file(`${ws}/bundles/acme/notes/loose.md`), '# x\n');
    assert.equal(loose.roots.bundleRoot.path, ws);
  } finally {
    __setWorkspaceFolders([SAMPLES]);
    __setFiles(ALL);
  }
});
