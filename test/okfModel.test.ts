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

const BUNDLE = path.resolve(__dirname, '..', '..', 'samples', 'okf', 'handbook', 'wiki');
const load = (rel: string) => {
  const data = readFrontMatter(fs.readFileSync(path.join(BUNDLE, rel), 'utf8'));
  assert.ok(data, `${rel} has front matter`);
  return parseOkf(data);
};

test('timestamps stay the strings their authors wrote', () => {
  const meta = load('decisions/read-replicas.md');
  assert.equal(meta.generated?.at, '2026-08-07T10:00:00+09:00');
  assert.equal(formatDate(meta.generated?.at), '2026-08-07');
  const incident = load('incidents/db-outage.md');
  assert.equal(incident.raw.created, '2026-08-07');
});

test('the three actor forms are told apart', () => {
  assert.deepEqual(parseActor('human:alice'), { raw: 'human:alice', kind: 'human', id: 'alice' });
  assert.deepEqual(parseActor('process:ci-lint'), { raw: 'process:ci-lint', kind: 'process', id: 'ci-lint' });
  assert.deepEqual(parseActor('my-agent/1.4'), {
    raw: 'my-agent/1.4', kind: 'producer', id: 'my-agent', version: '1.4',
  });
  assert.equal(parseActor('someone')?.kind, 'other');
  assert.equal(parseActor(''), undefined);
});

test('a bare verified mapping is a list of one, and a human makes it human-reviewed', () => {
  const meta = load('decisions/read-replicas.md');
  assert.equal(meta.verified.length, 1);
  assert.equal(meta.verified[0].by.raw, 'human:alice');
  assert.equal(meta.trust, 'human');
});

test('trust tiers follow OKF §5.3', () => {
  assert.equal(load('decisions/read-replicas-benchmark.md').trust, 'machine');
  assert.equal(load('incidents/db-outage.md').trust, 'unverified');
});

test('status defaults to stable, and lifecycle helpers read their keys', () => {
  const incident = load('incidents/db-outage.md');
  assert.equal(incident.status, 'stable');
  const report = load('sources/old-capacity-report.md');
  assert.equal(report.status, 'deprecated');
  assert.equal(isStale(report, Date.parse('2026-10-13T00:00:00Z')), true);
  assert.equal(isStale(report, Date.parse('2025-10-13T00:00:00Z')), false);
  assert.equal(isStale(incident, Date.now()), undefined);
  assert.equal(parseOkf({ type: 'x' }).statusDeclared, false);
});

test('sources are typed, keeping extra keys such as relation', () => {
  const meta = load('decisions/read-replicas.md');
  assert.equal(meta.sources.length, 2);
  assert.equal(meta.sources[0].id, 'bench1');
  assert.equal(meta.sources[0].resource, 'read-replicas-benchmark.md');
  assert.deepEqual(meta.sources[0].extra, [['relation', 'arising-from']]);
  // last_modified (2026-08-09) is after generated.at (2026-08-07).
  assert.deepEqual(sourcesNewerThanPage(meta).map((s) => s.id), ['bench1']);
});

test('keys outside the core are kept, in the order they were written', () => {
  const meta = load('incidents/db-outage.md');
  assert.deepEqual(
    meta.extensions.map(([key]) => key),
    ['origin', 'priority', 'impact', 'resolved_by', 'related_incidents', 'created', 'phase', 'root']
  );
});

test('the bundle index carries only okf_version', () => {
  const meta = load('index.md');
  assert.equal(meta.okfVersion, '0.2');
  assert.equal(meta.type, undefined);
  assert.deepEqual(meta.extensions, []);
});
