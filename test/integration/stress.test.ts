import * as vscode from 'vscode';
import * as path from 'path';
import { assert, getApi, test, waitFor } from './harness';
import { allTabs, closeEverything, describeTabs } from './shared';

const RING = path.join(__dirname, '..', '..', 'test', 'fixtures', 'ring');
const first = vscode.Uri.file(path.join(RING, 'p0.md'));

function preview() {
  return getApi().previews.find((p) => p.uri.includes('/ring/'));
}

async function settled(suffix: string, mode: string, since: number) {
  return waitFor(
    `${suffix} to settle after ${mode}`,
    () => {
      const scroll = preview()?.lastScroll;
      return preview()?.uri.endsWith(suffix) && scroll && scroll.mode === mode && scroll.at >= since
        ? scroll
        : undefined;
    },
    15000
  );
}

test('STRESS: following 60 links in a row keeps the preview alive', async () => {
  await closeEverything();
  const since = Date.now();
  await vscode.commands.executeCommand('vscode.open', first);
  await settled('p0.md', 'push', since);

  for (let step = 1; step <= 60; step++) {
    const target = `p${step % 6}.md`;
    const at = Date.now();
    getApi().followLink(target, 0);
    await settled(target, 'push', at);
    assert.equal(allTabs().length, 1, `step ${step} opened a stray tab: ${describeTabs()}`);
  }

  assert.equal(getApi().previews.length, 1);
  assert.ok(preview()?.isReady, 'the preview page is still alive');
});

test('STRESS: walking the whole history back and forward', async () => {
  const depth = 30;
  for (let step = 0; step < depth; step++) {
    const at = Date.now();
    if (!preview()?.canGoBack) {
      break;
    }
    getApi().goBack();
    await waitFor(`a back settle at step ${step}`, () => {
      const scroll = preview()?.lastScroll;
      return scroll && scroll.mode === 'back' && scroll.at >= at ? scroll : undefined;
    }, 15000);
  }

  for (let step = 0; step < depth; step++) {
    const at = Date.now();
    if (!preview()?.canGoForward) {
      break;
    }
    getApi().goForward();
    await waitFor(`a forward settle at step ${step}`, () => {
      const scroll = preview()?.lastScroll;
      return scroll && scroll.mode === 'forward' && scroll.at >= at ? scroll : undefined;
    }, 15000);
  }

  assert.equal(allTabs().length, 1, describeTabs());
  assert.ok(preview()?.isReady);
  console.log(`\n  renders after stress       ${preview()?.renderCount}\n`);
});

test('STRESS: rapid clicking without waiting for each render', async () => {
  await closeEverything();
  const since = Date.now();
  await vscode.commands.executeCommand('vscode.open', first);
  await settled('p0.md', 'push', since);

  // No awaiting between hops: this is what a reader clicking quickly actually does.
  for (let step = 1; step <= 40; step++) {
    getApi().followLink(`p${step % 6}.md`, 0);
  }
  await new Promise((resolve) => setTimeout(resolve, 3000));

  assert.equal(getApi().previews.length, 1, 'the preview survived the burst');
  assert.equal(allTabs().length, 1, describeTabs());
  assert.ok(preview()?.isReady, 'the preview page is still alive');
});

test('nothing failed to render during the whole run', async () => {
  // A document that fails to render still produces a tab with the right title and a
  // working history, so every other assertion here can pass while the page shows an
  // error. This is the check that catches that.
  assert.equal(getApi().renderErrors, 0, 'see the mdExplorer output channel for details');
});
