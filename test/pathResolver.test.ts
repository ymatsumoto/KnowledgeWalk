import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { looksLikePath, resolveRef, type RefContext } from '../src/okf/pathResolver';

// Mirrors samples/okf: wiki root `handbook/`, OKF bundle `handbook/wiki/`.
const ROOT = '/ws/handbook';
const ctx: RefContext = {
  docDir: `${ROOT}/wiki/decisions`,
  bundleRoot: `${ROOT}/wiki`,
  wikiRoot: ROOT,
};

const FILES = new Set([
  `${ROOT}/wiki/decisions/read-replicas.md`,
  `${ROOT}/wiki/decisions/benchmark.md`,
  `${ROOT}/wiki/incidents/db-outage.md`,
  `${ROOT}/wiki/sources/report.md`,
  `${ROOT}/wiki/notes/dup.md`,
  `${ROOT}/notes/dup.md`,
  `${ROOT}/attachments/diagram.pdf`,
  '/srv/shared/report.md',
]);
const exists = (p: string) => FILES.has(p);

test('the five shapes found in generated OKF wikis each resolve against their own base', () => {
  assert.deepEqual(resolveRef('../sources/report.md', ctx, exists), {
    kind: 'file', path: `${ROOT}/wiki/sources/report.md`, isMarkdown: true, fragment: undefined, via: 'doc',
  });
  assert.deepEqual(resolveRef('benchmark.md', ctx, exists), {
    kind: 'file', path: `${ROOT}/wiki/decisions/benchmark.md`, isMarkdown: true, fragment: undefined, via: 'doc',
  });
  assert.deepEqual(resolveRef('incidents/db-outage', ctx, exists), {
    kind: 'file', path: `${ROOT}/wiki/incidents/db-outage.md`, isMarkdown: true, fragment: undefined, via: 'bundle',
  });
  assert.deepEqual(resolveRef('attachments/diagram.pdf', ctx, exists), {
    kind: 'file', path: `${ROOT}/attachments/diagram.pdf`, isMarkdown: false, fragment: undefined, via: 'wiki',
  });
  assert.deepEqual(resolveRef('/srv/shared/report.md', ctx, exists), {
    kind: 'file', path: '/srv/shared/report.md', isMarkdown: true, fragment: undefined, via: 'fs', nonPortable: true,
  });
});

test('a leading slash is read from the bundle root first', () => {
  const result = resolveRef('/incidents/db-outage.md', ctx, exists);
  assert.equal(result.kind, 'file');
  assert.equal(result.kind === 'file' && result.path, `${ROOT}/wiki/incidents/db-outage.md`);
  assert.equal(result.kind === 'file' && result.via, 'bundle');
  assert.equal(result.kind === 'file' && result.nonPortable, undefined);
});

test('a name that exists under two bases is refused, not guessed', () => {
  assert.deepEqual(resolveRef('notes/dup.md', ctx, exists), {
    kind: 'ambiguous',
    candidates: [`${ROOT}/wiki/notes/dup.md`, `${ROOT}/notes/dup.md`],
  });
});

test('a missing file is reported, strongly only when it looks like a file', () => {
  const withExt = resolveRef('incidents/nope.md', ctx, exists);
  assert.equal(withExt.kind, 'missing');
  assert.equal(withExt.kind === 'missing' && withExt.strong, true);

  const actor = resolveRef('my-agent/1.4', ctx, exists);
  assert.equal(actor.kind, 'missing');
  assert.equal(actor.kind === 'missing' && actor.strong, false);

  const relative = resolveRef('../nope', ctx, exists);
  assert.equal(relative.kind === 'missing' && relative.strong, true);
});

test('a fragment is carried and does not disturb resolution', () => {
  const result = resolveRef('incidents/db-outage#Überblick', ctx, exists);
  assert.equal(result.kind === 'file' && result.fragment, 'Überblick');
  assert.equal(result.kind === 'file' && result.path, `${ROOT}/wiki/incidents/db-outage.md`);
});

test('URLs are external and prose is text', () => {
  assert.deepEqual(resolveRef('https://doi.org/10.1/x', ctx, exists), {
    kind: 'external', href: 'https://doi.org/10.1/x',
  });
  assert.deepEqual(resolveRef('own-work', ctx, exists), { kind: 'text' });
  assert.deepEqual(resolveRef('Primary database outage', ctx, exists), { kind: 'text' });
  assert.deepEqual(resolveRef('a title with/slash', ctx, exists), { kind: 'text' });
  assert.deepEqual(resolveRef('v0.2', ctx, exists), { kind: 'text' });
});

test('looksLikePath separates paths from ordinary values', () => {
  for (const value of ['a.md', 'x/y', '../a', '/abs/p.pdf', 'https://e.org', 'p#h']) {
    if (value === 'p#h') {
      assert.equal(looksLikePath(value), false, value);
    } else {
      assert.equal(looksLikePath(value), true, value);
    }
  }
  for (const value of ['', 'stable', '2026-08-07', '1.5', 'two words.md']) {
    assert.equal(looksLikePath(value), false, value);
  }
});

test('when every base coincides a file is still found once', () => {
  const flat: RefContext = { docDir: '/ws', bundleRoot: '/ws', wikiRoot: '/ws' };
  assert.deepEqual(resolveRef('a/b.md', flat, (p) => p === '/ws/a/b.md'), {
    kind: 'file', path: '/ws/a/b.md', isMarkdown: true, fragment: undefined, via: 'doc',
  });
});

test('a bare name with an unfamiliar extension is not reported missing', () => {
  const name = resolveRef('db.prod', ctx, exists);
  assert.equal(name.kind === 'missing' && name.strong, false);
  const known = resolveRef('nope.pdf', ctx, exists);
  assert.equal(known.kind === 'missing' && known.strong, true);
  const pathy = resolveRef('data/nope.prod', ctx, exists);
  assert.equal(pathy.kind === 'missing' && pathy.strong, true);
});

test('extra file extensions make a missing value worth reporting', () => {
  const plain = resolveRef('reads.fasta', ctx, exists);
  assert.equal(plain.kind === 'missing' && plain.strong, false);
  const configured = resolveRef('reads.fasta', { ...ctx, fileExtensions: new Set(['.fasta']) }, exists);
  assert.equal(configured.kind === 'missing' && configured.strong, true);
});
