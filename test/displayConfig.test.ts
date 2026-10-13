import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  DEFAULT_DISPLAY,
  displayForType,
  fieldSpec,
  fillTemplate,
  mergeDisplay,
} from '../src/okf/displayConfig';

test('with no configuration the OKF defaults apply', () => {
  const { config, warnings } = mergeDisplay(undefined, undefined);
  assert.deepEqual(warnings, []);
  assert.deepEqual(config.header, DEFAULT_DISPLAY.header);
  assert.equal(fieldSpec(config, 'sources').as, 'sources');
  assert.equal(fieldSpec(config, 'root').as, 'hidden');
  // Anything nobody configured is shown by the auto rule.
  assert.equal(fieldSpec(config, 'stage').as, 'auto');
});

test('layers merge key by key, later layers winning, and arrays replace', () => {
  const user = { fields: { stage: { as: 'badge' } }, header: ['type'] };
  const local = {
    fields: { stage: { colors: { open: 'red' } }, status: { colors: { draft: 'orange' } } },
    hidden: ['root', 'okf_version', 'provenance'],
  };
  const { config, warnings } = mergeDisplay(user, local);
  assert.deepEqual(warnings, []);
  assert.deepEqual(config.header, ['type']);
  assert.deepEqual(fieldSpec(config, 'stage'), { as: 'badge', colors: { open: 'red' } });
  // The default status colours survive alongside the one that was overridden.
  assert.deepEqual(fieldSpec(config, 'status').colors, {
    draft: 'orange', stable: 'green', deprecated: 'gray',
  });
  assert.equal(fieldSpec(config, 'provenance').as, 'hidden');
});

test('byType is layered last, for the document type only', () => {
  const { config } = mergeDisplay({
    byType: { source: { header: ['type', 'citekey'], fields: { citekey: { as: 'badge' } } } },
  });
  assert.deepEqual(displayForType(config, 'source').config.header, ['type', 'citekey']);
  assert.equal(fieldSpec(displayForType(config, 'source').config, 'citekey').as, 'badge');
  assert.deepEqual(displayForType(config, 'problem').config.header, DEFAULT_DISPLAY.header);
  assert.deepEqual(displayForType(config, undefined).config.header, DEFAULT_DISPLAY.header);
});

test('bad settings are reported and fall back rather than failing', () => {
  const { config, warnings } = mergeDisplay({
    fields: {
      stage: { as: 'sparkle' },
      severity: { as: 'badge', colors: { high: 'magenta' } },
      generated: { as: 'template', template: undefined },
      shorthand: 'chips',
    },
    header: 'type',
    nonsense: true,
  });
  assert.equal(fieldSpec(config, 'stage').as, 'auto');
  assert.deepEqual(fieldSpec(config, 'severity'), { as: 'badge', colors: {} });
  assert.equal(fieldSpec(config, 'shorthand').as, 'chips');
  assert.deepEqual(config.header, DEFAULT_DISPLAY.header);
  assert.equal(warnings.length, 4, warnings.join('\n'));
  assert.ok(warnings.some((w) => w.includes('sparkle')));
  assert.ok(warnings.some((w) => w.includes('magenta')));
  assert.ok(warnings.some((w) => w.includes('nonsense')));
  assert.ok(warnings.some((w) => w.startsWith('header')));
  // The default template survives an override that did not supply one.
  assert.equal(fieldSpec(config, 'generated').as, 'template');
});

test('a layer that is not a mapping is ignored with a warning', () => {
  const { config, warnings } = mergeDisplay(['header']);
  assert.equal(warnings.length, 1);
  assert.deepEqual(config.header, DEFAULT_DISPLAY.header);
});

test('templates fill placeholders as plain text', () => {
  const date = (v: string) => v.slice(0, 10);
  assert.equal(
    fillTemplate('🤖 {by} · {at|date}', { by: 'claude-code/unknown', at: '2026-08-07T10:00:00+09:00' }, { date }),
    '🤖 claude-code/unknown · 2026-08-07'
  );
  assert.equal(fillTemplate('{a.b} {missing} {value}', { a: { b: 1 } }, {}), '1  ');
  assert.equal(fillTemplate('[{value}]', 'scalar', {}), '[scalar]');
  // Markup in a value or a template is returned as text; the caller escapes it.
  assert.equal(fillTemplate('{x}', { x: '<script>' }, {}), '<script>');
});
