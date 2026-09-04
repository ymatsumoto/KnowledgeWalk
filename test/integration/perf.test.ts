import * as vscode from 'vscode';
import * as path from 'path';
import { assert, getApi, test, waitFor } from './harness';
import { closeEverything, sample } from './shared';

const FIXTURES = path.join(__dirname, '..', '..', 'test', 'fixtures');
const scrollMd = vscode.Uri.file(path.join(FIXTURES, 'scroll.md'));

const timings: Record<string, number> = {};

function previewFor(suffix: string) {
  return getApi().previews.find((preview) => preview.uri.endsWith(suffix));
}

/** Wait for a settle report for `suffix` that is newer than `since`. */
async function settledFor(suffix: string, mode: string, since: number) {
  return waitFor(
    `a ${mode} settle report for ${suffix}`,
    () => {
      const scroll = previewFor(suffix)?.lastScroll;
      return scroll && scroll.mode === mode && scroll.at >= since ? scroll : undefined;
    },
    20000
  );
}

async function measure(name: string, suffix: string, mode: string, action: () => unknown) {
  const started = Date.now();
  await action();
  await settledFor(suffix, mode, started);
  timings[name] = Date.now() - started;
}

test('PERF: cold open (first document of the session)', async () => {
  await closeEverything();
  await measure('cold open -> painted', 'samples/index.md', 'push', () =>
    vscode.commands.executeCommand('vscode.open', sample('index.md'))
  );
});

test('PERF: warm open (extension already running)', async () => {
  await closeEverything();
  await measure('warm open -> painted', 'fixtures/scroll.md', 'push', () =>
    vscode.commands.executeCommand('vscode.open', scrollMd)
  );
});

test('PERF: following a link inside the tab', async () => {
  await measure('in-tab navigation', 'fixtures/target.md', 'push', () =>
    getApi().followLink('target.md', 0)
  );
});

test('PERF: going back', async () => {
  await measure('back', 'fixtures/scroll.md', 'back', () => getApi().goBack());
});

test('PERF: a second tab alongside the first', async () => {
  await measure('second tab -> painted', 'samples/guide.md', 'push', () =>
    vscode.commands.executeCommand('vscode.open', sample('guide.md'))
  );
});

test('PERF: report', async () => {
  console.log('\n--- timings (ms) ---');
  for (const [name, ms] of Object.entries(timings)) {
    console.log(`  ${name.padEnd(26)} ${ms}`);
  }
  const renders = getApi().previews.map((p) => `${p.title}:${p.renderCount}`).join(' ');
  console.log(`  renders per tab            ${renders}`);
  console.log('--------------------\n');
  assert.equal(Object.keys(timings).length, 5);
});
