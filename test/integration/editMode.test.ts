import * as vscode from 'vscode';
import { assert, getApi, test, waitFor } from './harness';
import { activeTab, allTabs, closeEverything, describeTabs, openThroughResolver, sample } from './shared';

const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

test('Open in Editor replaces the preview with a plain text editor', async () => {
  await closeEverything();
  await openThroughResolver(sample('guide.md'));
  await waitFor('the preview to become active', () => getApi().activePreview);

  await vscode.commands.executeCommand('knowledgeWalk.switchToEditor');

  const tab = await waitFor('a text editor for guide.md', () => {
    const candidate = activeTab();
    return candidate?.input instanceof vscode.TabInputText ? candidate : undefined;
  });

  assert.equal(tab.label, 'guide.md');
  await waitFor(`the preview to close (tabs: ${describeTabs()})`, () => allTabs().length === 1);
  assert.equal(getApi().previews.length, 0);
  assert.equal(vscode.window.activeTextEditor?.document.languageId, 'markdown');
});

test('an editor opened deliberately is not pulled back into a preview', async () => {
  // The reclaim safety net runs on every tab change; give it every chance to misfire.
  await settle();
  assert.ok(
    activeTab()?.input instanceof vscode.TabInputText,
    `the editor must stay open: ${describeTabs()}`
  );
  assert.equal(getApi().previews.length, 0, describeTabs());
});

test('Open Preview turns the text editor back into a preview', async () => {
  await vscode.commands.executeCommand('knowledgeWalk.showPreview');

  const tab = await waitFor('the preview to come back', () => {
    const candidate = activeTab();
    return candidate?.input instanceof vscode.TabInputWebview ? candidate : undefined;
  });

  assert.equal(tab.label, 'guide.md');
  await waitFor(`the text editor to close (tabs: ${describeTabs()})`, () => allTabs().length === 1);
  assert.equal(getApi().previews.length, 1);
});

test('Open Preview to the Side leaves the editor open and adds a preview', async () => {
  await closeEverything();
  const uri = sample('guide.md');
  await vscode.commands.executeCommand('knowledgeWalk.showPreviewToSide', uri);
  await waitFor('the side preview', () => getApi().previews.length === 1);

  await vscode.commands.executeCommand('vscode.openWith', uri, 'default');
  await waitFor('the text editor', () => allTabs().some((t) => t.input instanceof vscode.TabInputText));

  await settle();
  assert.ok(
    allTabs().some((t) => t.input instanceof vscode.TabInputText),
    `the editor must stay open beside the preview: ${describeTabs()}`
  );
  assert.equal(getApi().previews.length, 1, describeTabs());
});

test('a Markdown file that slips into a plain text editor is turned into a preview', async () => {
  await closeEverything();
  const uri = sample('index.md');
  // 'default' bypasses the custom editor entirely — the same thing a restored tab or a
  // workbench.editorAssociations override does.
  await vscode.commands.executeCommand('vscode.openWith', uri, 'default');

  const tab = await waitFor('the editor to be reclaimed as a preview', () => {
    const candidate = activeTab();
    return candidate?.input instanceof vscode.TabInputWebview ? candidate : undefined;
  });
  assert.equal(tab.label, 'index.md');
  await waitFor(`only the preview to remain (tabs: ${describeTabs()})`, () => allTabs().length === 1);
});

test('the reclaim safety net can be switched off', async () => {
  const config = vscode.workspace.getConfiguration('knowledgeWalk');
  await config.update('reclaimTextEditors', false, vscode.ConfigurationTarget.Global);
  try {
    await closeEverything();
    await vscode.commands.executeCommand('vscode.openWith', sample('index.md'), 'default');
    await settle();
    assert.ok(
      activeTab()?.input instanceof vscode.TabInputText,
      `the editor should be left alone: ${describeTabs()}`
    );
  } finally {
    await config.update('reclaimTextEditors', undefined, vscode.ConfigurationTarget.Global);
  }
});

test('Open in Editor works when focus has moved out of the editor area', async () => {
  await closeEverything();
  await openThroughResolver(sample('guide.md'));
  await waitFor('the preview', () => getApi().previews.length === 1);

  // The title-bar button stays visible while focus is in the side bar, because VS Code
  // still considers the preview the *active editor* — but WebviewPanel.active means
  // focus, so the two disagree exactly here.
  await vscode.commands.executeCommand('workbench.view.explorer');
  await new Promise((resolve) => setTimeout(resolve, 300));

  await vscode.commands.executeCommand('knowledgeWalk.switchToEditor');

  const tab = await waitFor('a text editor for guide.md', () => {
    const candidate = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .find((t) => t.input instanceof vscode.TabInputText);
    return candidate;
  }, 6000);
  assert.equal(tab.label, 'guide.md');
});

test('PERF: switching to the editor is not slow', async () => {
  await closeEverything();
  await openThroughResolver(sample('index.md'));
  await waitFor('the preview', () => getApi().previews.length === 1);
  await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');

  const started = Date.now();
  await vscode.commands.executeCommand('knowledgeWalk.switchToEditor');
  await waitFor(
    'the text editor',
    () => vscode.window.activeTextEditor?.document.uri.path.endsWith('index.md'),
    10000
  );
  const elapsed = Date.now() - started;
  console.log(`\n  switch to editor            ${elapsed} ms\n`);
  assert.ok(elapsed < 1500, `switching to the editor took ${elapsed}ms`);
});

test('a double-click that is really the tail of a link click is ignored', async () => {
  await closeEverything();
  await openThroughResolver(sample('index.md'));
  await waitFor('the preview', () => getApi().previews.length === 1);

  // Following a link replaces the page under the pointer, so the second half of a
  // double-click lands on body text instead of the link and looks like an edit gesture.
  getApi().followLink('guide.md', 1);
  getApi().editGesture(0);

  await settle();
  assert.equal(getApi().previews.length, 1, `the preview must survive: ${describeTabs()}`);
  assert.ok(
    activeTab()?.input instanceof vscode.TabInputWebview,
    `still a preview, not an editor: ${describeTabs()}`
  );
  assert.ok(getApi().previews[0].uri.endsWith('/guide.md'), 'and the link was followed');
});

test('a deliberate double-click still opens the editor', async () => {
  // Well clear of the guard window that protects a navigation.
  await new Promise((resolve) => setTimeout(resolve, 900));
  getApi().editGesture(3);

  const tab = await waitFor('a text editor', () => {
    const candidate = activeTab();
    return candidate?.input instanceof vscode.TabInputText ? candidate : undefined;
  }, 6000);
  assert.equal(tab.label, 'guide.md');
  await waitFor(`the preview to close (${describeTabs()})`, () => getApi().previews.length === 0);
});
