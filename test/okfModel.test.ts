import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readFrontMatter } from '../src/renderer/frontMatter';
import {
  formatDate,
  isStale,
  parseActor,
  parseOkf,
  sourcesNewerThanPage,
} from '../src/okf/model';

const BUNDLE = path.resolve(__dirname, '..', '..', 'samples', 'okf', 'research', 'wiki');
const load = (rel: string) => {
  const data = readFrontMatter(fs.readFileSync(path.join(BUNDLE, rel), 'utf8'));
  assert.ok(data, `${rel} has front matter`);
  return parseOkf(data);
};

test('timestamps stay the strings their authors wrote', () => {
  const meta = load('ideas/i1.md');
  assert.equal(meta.generated?.at, '2026-08-07T10:00:00+09:00');
  assert.equal(formatDate(meta.generated?.at), '2026-08-07');
  const problem = load('problems/p1.md');
  assert.equal(problem.raw.created, '2026-08-07');
});

test('the three actor forms are told apart', () => {
  assert.deepEqual(parseActor('human:ymatsumoto'), { raw: 'human:ymatsumoto', kind: 'human', id: 'ymatsumoto' });
  assert.deepEqual(parseActor('process:ci-lint'), { raw: 'process:ci-lint', kind: 'process', id: 'ci-lint' });
  assert.deepEqual(parseActor('claude-code/unknown'), {
    raw: 'claude-code/unknown', kind: 'producer', id: 'claude-code', version: 'unknown',
  });
  assert.equal(parseActor('someone')?.kind, 'other');
  assert.equal(parseActor(''), undefined);
});

test('a bare verified mapping is a list of one, and a human makes it human-reviewed', () => {
  const meta = load('ideas/i1.md');
  assert.equal(meta.verified.length, 1);
  assert.equal(meta.verified[0].by.raw, 'human:ymatsumoto');
  assert.equal(meta.trust, 'human');
});

test('trust tiers follow OKF §5.3', () => {
  assert.equal(load('ideas/i1-progress.md').trust, 'machine');
  assert.equal(load('problems/p1.md').trust, 'unverified');
});

test('status defaults to stable, and lifecycle helpers read their keys', () => {
  const problem = load('problems/p1.md');
  assert.equal(problem.status, 'stable');
  const s1 = load('sources/s1.md');
  assert.equal(s1.status, 'deprecated');
  assert.equal(isStale(s1, Date.parse('2026-10-13T00:00:00Z')), true);
  assert.equal(isStale(s1, Date.parse('2025-10-13T00:00:00Z')), false);
  assert.equal(isStale(problem, Date.now()), undefined);
  assert.equal(parseOkf({ type: 'x' }).statusDeclared, false);
});

test('sources are typed, keeping extra keys such as relation', () => {
  const meta = load('ideas/i1.md');
  assert.equal(meta.sources.length, 2);
  assert.equal(meta.sources[0].id, 'progress1');
  assert.equal(meta.sources[0].resource, 'i1-progress.md');
  assert.deepEqual(meta.sources[0].extra, [['relation', 'arising-from']]);
  // last_modified (2026-08-09) is after generated.at (2026-08-07).
  assert.deepEqual(sourcesNewerThanPage(meta).map((s) => s.id), ['progress1']);
});

test('keys outside the core are kept, in the order they were written', () => {
  const meta = load('problems/p1.md');
  assert.deepEqual(
    meta.extensions.map(([key]) => key),
    ['provenance', 'severity', 'maturity', 'addressed_by', 'related_problems', 'created', 'stage', 'root']
  );
});

test('the bundle index carries only okf_version', () => {
  const meta = load('index.md');
  assert.equal(meta.okfVersion, '0.2');
  assert.equal(meta.type, undefined);
  assert.deepEqual(meta.extensions, []);
});
