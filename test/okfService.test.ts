import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Uri, __setFiles, __setStatPaths, __setWorkspaceFolders } from 'vscode';
import { WikiLinkIndex } from '../src/wikiIndex';
import { OkfService } from '../src/okf/service';

const SAMPLES = path.resolve(__dirname, '..', '..', 'samples');
const RESEARCH = path.join(SAMPLES, 'okf', 'research');
const BUNDLE = path.join(RESEARCH, 'wiki');

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
  const prepared = await prepare('ideas/i1.md');
  assert.equal(prepared.roots.wikiRoot.path, RESEARCH);
  assert.equal(prepared.roots.bundleRoot.path, BUNDLE);
  assert.equal(prepared.roots.okfVersion, '0.2');
  assert.equal(prepared.frontMatter?.type, 'idea');
});

test('a document outside any bundle uses its wiki root for both', async () => {
  const file = path.join(RESEARCH, 'notes', 'dup.md');
  const prepared = await service.prepare(Uri.file(file), fs.readFileSync(file, 'utf8'));
  assert.equal(prepared.roots.wikiRoot.path, RESEARCH);
  assert.equal(prepared.roots.bundleRoot.path, RESEARCH);
  assert.equal(prepared.roots.okfVersion, undefined);
});

test('a document with no root: and no bundle falls back to the workspace folder', async () => {
  const file = path.join(SAMPLES, 'guide.md');
  const prepared = await service.prepare(Uri.file(file), fs.readFileSync(file, 'utf8'));
  assert.equal(prepared.roots.wikiRoot.path, SAMPLES);
  assert.equal(prepared.roots.bundleRoot.path, SAMPLES);
});

test('indexed files exist without a stat; others are checked on disk once', async () => {
  __setStatPaths(['/root/work/planC/REPORT.md']);
  try {
    const prepared = await prepare('sources/s1.md');
    assert.equal(prepared.exists(path.join(BUNDLE, 'problems', 'p1.md')), true);
    assert.equal(prepared.exists('/root/work/planC/REPORT.md'), true);
    assert.equal(prepared.exists(path.join(BUNDLE, 'nope.md')), false);
  } finally {
    __setStatPaths([]);
  }
});

test('the wiki root .mdexplorer.yaml is layered over the settings, then byType', async () => {
  const problem = await prepare('problems/p1.md');
  assert.equal(problem.display.fields.severity?.as, 'badge');
  assert.equal(problem.display.fields.severity?.colors?.high, 'red');
  assert.deepEqual(problem.display.header, ['type', 'status', 'trust', 'generated', 'severity', 'stage']);

  const file = path.join(BUNDLE, 'problems', 'p1.md');
  const withUser = await service.prepare(Uri.file(file), fs.readFileSync(file, 'utf8'), {
    fields: { maturity: { as: 'badge' }, severity: { as: 'text' } },
  });
  assert.equal(withUser.display.fields.maturity?.as, 'badge');
  // The wiki's own file wins over the user's setting.
  assert.equal(withUser.display.fields.severity?.as, 'badge');
});

test('a document outside a configured wiki gets the defaults', async () => {
  const file = path.join(SAMPLES, 'guide.md');
  const prepared = await service.prepare(Uri.file(file), fs.readFileSync(file, 'utf8'));
  assert.equal(prepared.display.fields.severity, undefined);
});
