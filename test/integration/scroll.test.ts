import * as vscode from 'vscode';
import * as path from 'path';
import { assert, getApi, test, waitFor } from './harness';
import { closeEverything } from './shared';

const FIXTURES = path.join(__dirname, '..', '..', 'test', 'fixtures');
const scrollMd = vscode.Uri.file(path.join(FIXTURES, 'scroll.md'));

/** The fixture holds exactly one link, so its id is always 0. */
const ONLY_LINK = 0;

/** Look the tab up by document, not by position: other suites may leave tabs behind. */
function previewFor(suffix: string) {
  return getApi().previews.find((preview) => preview.uri.endsWith(suffix));
}

/**
 * Wait for a settle report that belongs to *this* navigation.
 *
 * Both conditions matter: `since` rejects the report left over from the previous page —
 * a tab's uri changes the instant a link is followed, so without it the next assertion
 * races the render it is meant to observe — and `final` waits out the late reflows (web
 * fonts, images, the KaTeX stylesheet) that move the page after the first paint.
 */
async function settledAt(suffix: string, mode: string, since: number) {
  return waitFor(
    `${suffix} to settle after ${mode}`,
    () => {
      const scroll = previewFor(suffix)?.lastScroll;
      return scroll && scroll.mode === mode && scroll.final && scroll.at >= since
        ? scroll
        : undefined;
    },
    10000
  );
}

test('a document opened fresh starts at the top', async () => {
  await closeEverything();
  const since = Date.now();
  await vscode.commands.executeCommand('vscode.open', scrollMd);
  await waitFor('the preview page to load', () => getApi().activePreview?.isReady, 15000);

  const settled = await settledAt('fixtures/scroll.md', 'push', since);
  assert.equal(settled.scrollTop, 0);
});

test('following a link lands at the top of the new page', async () => {
  // Scroll rules only matter once the page is long enough to scroll at all.
  const since = Date.now();
  getApi().followLink('target.md', ONLY_LINK);
  await waitFor('target.md', () => previewFor('/target.md'));

  const settled = await settledAt('fixtures/target.md', 'push', since);
  assert.equal(settled.scrollTop, 0, 'a followed link opens at the top of the page');
});

test('Back puts the link that was followed back at the top of the view', async () => {
  const since = Date.now();
  getApi().goBack();
  await waitFor('scroll.md', () => previewFor('/scroll.md'));

  const settled = await settledAt('fixtures/scroll.md', 'back', since);
  assert.equal(settled.anchored, true, 'the followed link was found again');
  assert.ok(
    settled.scrollTop > 100,
    `Back must scroll down to the link, not sit at the top (got ${settled.scrollTop})`
  );
});

test('Forward returns to the top of the page, not to a remembered offset', async () => {
  const since = Date.now();
  getApi().goForward();
  await waitFor('target.md', () => previewFor('/target.md'));

  const settled = await settledAt('fixtures/target.md', 'forward', since);
  assert.equal(settled.scrollTop, 0);
});
