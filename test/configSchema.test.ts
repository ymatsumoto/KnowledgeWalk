import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { COLORS, FIELD_KINDS, TOP_LEVEL, mergeDisplay } from '../src/okf/displayConfig';

const ROOT = path.resolve(__dirname, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const schema = manifest.contributes.configuration.properties['mdExplorer.frontMatterDisplay'];

type Schema = Record<string, any>;

/** Enough of JSON Schema for this one: type, enum, properties, additionalProperties, items, anyOf. */
function validate(value: unknown, s: Schema, at = '$'): string[] {
  if (s.anyOf) {
    const results = (s.anyOf as Schema[]).map((branch) => validate(value, branch, at));
    return results.some((r) => r.length === 0) ? [] : [`${at}: matches no alternative (${results.map((r) => r[0]).join(' / ')})`];
  }
  const types = s.type === undefined ? undefined : ([] as string[]).concat(s.type);
  const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  if (types && !types.includes(actual)) {
    return [`${at}: expected ${types.join('|')}, got ${actual}`];
  }
  if (s.enum && !s.enum.includes(value)) {
    return [`${at}: ${JSON.stringify(value)} is not one of ${s.enum.join(', ')}`];
  }
  const errors: string[] = [];
  if (actual === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const sub = s.properties?.[key] ?? (typeof s.additionalProperties === 'object' ? s.additionalProperties : undefined);
      if (sub) {
        errors.push(...validate(item, sub, `${at}.${key}`));
      } else if (s.additionalProperties === false) {
        errors.push(`${at}.${key}: not allowed`);
      }
    }
  }
  if (actual === 'array' && s.items) {
    (value as unknown[]).forEach((item, i) => errors.push(...validate(item, s.items, `${at}[${i}]`)));
  }
  return errors;
}

/** Every `as` enum in the schema, wherever it appears. */
function enumsAt(s: unknown, key: string, found: unknown[][] = []): unknown[][] {
  if (s && typeof s === 'object') {
    for (const [k, v] of Object.entries(s as Schema)) {
      if (k === key && v && typeof v === 'object' && Array.isArray((v as Schema).enum)) {
        found.push((v as Schema).enum);
      }
      enumsAt(v, key, found);
    }
  }
  return found;
}

test('the setting schema names exactly the settings the code reads', () => {
  assert.deepEqual(Object.keys(schema.properties).sort(), [...TOP_LEVEL].sort());
  assert.deepEqual(
    Object.keys(schema.properties.byType.additionalProperties.properties).sort(),
    [...TOP_LEVEL].filter((k) => k !== 'byType').sort()
  );
});

test('the schema offers exactly the display kinds and colours the code accepts', () => {
  const kinds = enumsAt(schema, 'as');
  assert.ok(kinds.length >= 2);
  for (const list of kinds) {
    assert.deepEqual(list, [...FIELD_KINDS]);
  }
  const shorthand = schema.properties.fields.additionalProperties.anyOf[1].enum;
  assert.deepEqual(shorthand, [...FIELD_KINDS]);
  assert.deepEqual(schema.properties.fields.additionalProperties.anyOf[0].properties.colors.additionalProperties.enum, [...COLORS]);
});

test('the example configurations are valid, both to the schema and to the code', () => {
  for (const file of ['docs/research-wiki.mdexplorer.yaml', 'samples/okf/research/.mdexplorer.yaml']) {
    const data = yaml.load(fs.readFileSync(path.join(ROOT, file), 'utf8')) as { frontMatter: unknown };
    assert.deepEqual(validate(data.frontMatter, schema), [], file);
    assert.deepEqual(mergeDisplay(data.frontMatter).warnings, [], file);
  }
});

test('the schema rejects what the code would warn about', () => {
  const bad = { fields: { stage: { as: 'sparkle' }, sev: { colors: { high: 'magenta' } } }, nonsense: 1, details: 'open' };
  const errors = validate(bad, schema);
  assert.equal(errors.length, 4, errors.join('\n'));
  assert.equal(mergeDisplay(bad).warnings.length, 4);
});
