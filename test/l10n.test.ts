import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? sources(full) : full.endsWith('.ts') ? [full] : [];
  });
}

/** Every string literal passed to vscode.l10n.t in src/. */
function messages(): Set<string> {
  const found = new Set<string>();
  for (const file of sources(path.join(ROOT, 'src'))) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/l10n\.t\(\s*'((?:[^'\\]|\\.)*)'/g)) {
      found.add(match[1].replace(/\\'/g, "'"));
    }
  }
  return found;
}

test('package.json points VS Code at the l10n folder', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(manifest.l10n, './l10n');
});

for (const bundle of fs.readdirSync(path.join(ROOT, 'l10n')).filter((f) => f.startsWith('bundle.l10n.'))) {
  test(`${bundle} translates exactly the messages the code uses`, () => {
    const translated = JSON.parse(fs.readFileSync(path.join(ROOT, 'l10n', bundle), 'utf8'));
    const used = messages();
    assert.ok(used.size >= 10, `found ${used.size} messages`);
    assert.deepEqual([...used].filter((m) => !(m in translated)), [], 'untranslated');
    assert.deepEqual(Object.keys(translated).filter((m) => !used.has(m)), [], 'stale');
    for (const [message, translation] of Object.entries(translated)) {
      const placeholders = (s: string) => (s.match(/\{\d+\}/g) ?? []).sort().join();
      assert.equal(placeholders(translation as string), placeholders(message), message);
    }
  });
}
