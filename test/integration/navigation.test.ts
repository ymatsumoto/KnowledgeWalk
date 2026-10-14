import * as vscode from 'vscode';
import { assert, getApi, test, waitFor } from './harness';
import {
  activeTab,
  allTabs,
  closeEverything,
  describeTabs,
  openThroughResolver,
  sample,
  settleNavDebounce,
} from './shared';

test('following a markdown link stays in the same tab and renames it', async () => {
  await closeEverything();
  await openThroughResolver(sample('index.md'));
  await waitFor('the preview to become active', () => getApi().activePreview);

  getApi().followLink('guide.md', 3);

  const snapshot = await waitFor(
    'the preview to move to guide.md',
    () => {
      const current = getApi().activePreview;
      return current && current.uri.endsWith('/guide.md') ? current : undefined;
    }
  );

  assert.equal(snapshot.title, 'guide.md', 'the tab label follows the document');
  assert.equal(allTabs().length, 1, `navigation must not open a tab: ${describeTabs()}`);
  await waitFor(
    `the VS Code tab label to become guide.md (currently ${activeTab()?.label})`,
    () => activeTab()?.label === 'guide.md'
  );
  assert.equal(snapshot.historyLength, 2);
  assert.equal(snapshot.canGoBack, true);
  assert.equal(snapshot.canGoForward, false);
});

test('Back returns to the previous document in the same tab, remembering the link', async () => {
  await settleNavDebounce();
  getApi().goBack();

  const snapshot = await waitFor('the preview to return to index.md', () => {
    const current = getApi().activePreview;
    return current && current.uri.endsWith('/index.md') ? current : undefined;
  });

  assert.equal(snapshot.title, 'index.md');
  assert.equal(allTabs().length, 1, `Back must stay in the tab: ${describeTabs()}`);
  // This is what the webview scrolls to: the anchor that was followed out of index.md.
  assert.equal(snapshot.departureLinkId, 3);
  assert.equal(snapshot.canGoBack, false);
  assert.equal(snapshot.canGoForward, true);
});

test('Forward returns to the document that was left', async () => {
  await settleNavDebounce();
  getApi().goForward();

  const snapshot = await waitFor('the preview to move forward to guide.md', () => {
    const current = getApi().activePreview;
    return current && current.uri.endsWith('/guide.md') ? current : undefined;
  });

  assert.equal(snapshot.title, 'guide.md');
  assert.equal(allTabs().length, 1);
  assert.equal(snapshot.canGoForward, false);
});

test('navigating after Back discards the forward branch', async () => {
  await settleNavDebounce();
  getApi().goBack();
  await waitFor('back to index.md', () => getApi().activePreview?.uri.endsWith('/index.md'));

  getApi().followLink('sub/deep.md', 9);
  const snapshot = await waitFor('the preview to move to sub/deep.md', () => {
    const current = getApi().activePreview;
    return current && current.uri.endsWith('/sub/deep.md') ? current : undefined;
  });

  assert.equal(snapshot.title, 'deep.md');
  assert.equal(snapshot.canGoForward, false, 'guide.md must no longer be ahead of us');
  assert.equal(snapshot.historyLength, 2);
});

test('relative links resolve from the document that contains them', async () => {
  getApi().followLink('../guide.md#settings', 1);
  const snapshot = await waitFor('the preview to move up a directory', () => {
    const current = getApi().activePreview;
    return current && current.uri.endsWith('/guide.md') ? current : undefined;
  });
  assert.equal(snapshot.title, 'guide.md');
  assert.equal(allTabs().length, 1);
});

test('a link to a non-markdown file opens a normal editor instead', async () => {
  await closeEverything();
  await openThroughResolver(sample('index.md'));
  await waitFor('the preview to become active', () => getApi().activePreview);

  getApi().followLink('data/table.csv', 5);

  const tab = await waitFor(
    'a text editor for the CSV',
    () => allTabs().find((t) => t.label === 'table.csv')
  );
  assert.ok(tab.input instanceof vscode.TabInputText, `expected a text editor: ${describeTabs()}`);
  // The preview is still there, still showing the document it was showing.
  assert.equal(getApi().previews.length, 1);
  assert.ok(getApi().previews[0].uri.endsWith('/index.md'));
});

test('a second document opens in a tab of its own', async () => {
  await closeEverything();
  await openThroughResolver(sample('index.md'));
  await waitFor('the first preview', () => getApi().previews.length === 1);

  await openThroughResolver(sample('guide.md'));
  await waitFor('the second preview', () => getApi().previews.length === 2);

  assert.equal(allTabs().length, 2, describeTabs());
  const labels = allTabs().map((t) => t.label).sort();
  assert.deepEqual(labels, ['guide.md', 'index.md']);
});

test('re-opening a document already on screen reuses its tab', async () => {
  await openThroughResolver(sample('index.md'));
  await settleNavDebounce();
  assert.equal(getApi().previews.length, 2, 'no third preview should appear');
  assert.equal(allTabs().length, 2, describeTabs());
});

test('two quick Back clicks walk two entries', async () => {
  await closeEverything();
  await openThroughResolver(sample('index.md'));
  await waitFor('the preview to become active', () => getApi().activePreview);

  getApi().followLink('guide.md', 1);
  await waitFor('guide.md', () => getApi().activePreview?.uri.endsWith('/guide.md'));
  getApi().followLink('sub/deep.md', 2);
  await waitFor('deep.md', () => getApi().activePreview?.uri.endsWith('/sub/deep.md'));

  // No pause between them: a reader clicking the toolbar twice in quick succession.
  getApi().goBack();
  getApi().goBack();

  const snapshot = await waitFor('two steps back to index.md', () => {
    const current = getApi().activePreview;
    return current && current.uri.endsWith('/index.md') ? current : undefined;
  });
  assert.equal(snapshot.canGoBack, false);
  assert.equal(snapshot.historyIndex, 0);
});

test('ctrl-clicking a link opens a background tab and leaves the reader in place', async () => {
  await closeEverything();
  await openThroughResolver(sample('index.md'));
  await waitFor('the preview', () => getApi().previews.length === 1);

  getApi().followLink('guide.md', 2, /* newTab */ true);

  await waitFor('a second preview', () => getApi().previews.length === 2);
  await waitFor(`two tabs (${describeTabs()})`, () => allTabs().length === 2);

  const uris = getApi().previews.map((preview) => preview.uri).sort();
  assert.ok(uris[0].endsWith('/guide.md'), describeTabs());
  assert.ok(uris[1].endsWith('/index.md'), describeTabs());

  // The tab the reader was on keeps the document it was showing, and stays the active
  // one: the point of a background tab is that it does not interrupt the reader.
  const original = getApi().previews.find((preview) => preview.uri.endsWith('/index.md'));
  assert.ok(original, 'the original tab still shows index.md');
  assert.equal(original.canGoBack, false, 'and it did not navigate');
  await waitFor(
    `the reader's tab to stay in front (${describeTabs()})`,
    () => activeTab()?.label === 'index.md',
    4000
  );
});

test('ctrl-clicking a link that is already open reveals its tab instead of duplicating it', async () => {
  getApi().followLink('guide.md', 2, true);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(getApi().previews.length, 2, describeTabs());
  assert.equal(allTabs().length, 2, describeTabs());
});

test('an absolute file link — the form a wiki link resolves to — stays in the tab', async () => {
  await closeEverything();
  await openThroughResolver(sample('index.md'));
  await waitFor('the preview', () => getApi().previews.length === 1);

  // `[[guide]]` is rendered with the resolved document's URI as its href.
  getApi().followLink(sample('guide.md').toString(), 4);

  const snapshot = await waitFor('the preview to move to guide.md', () => {
    const current = getApi().previews[0];
    return current?.uri.endsWith('/guide.md') ? current : undefined;
  });
  assert.equal(snapshot.title, 'guide.md');
  await waitFor(`one tab (${describeTabs()})`, () => allTabs().length === 1);
  assert.equal(snapshot.canGoBack, true);
});

test('an absolute file link with a fragment carries the fragment', async () => {
  const withFragment = `${sample('index.md').toString()}#%E6%95%B0%E5%BC%8F`;
  getApi().followLink(withFragment, 5);
  await waitFor('index.md', () => getApi().previews[0]?.uri.endsWith('/index.md'));
  await waitFor(`one tab (${describeTabs()})`, () => allTabs().length === 1);
});
