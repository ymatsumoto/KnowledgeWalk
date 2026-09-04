import * as vscode from 'vscode';
import * as path from 'path';
import { assert, getApi, test, waitFor } from './harness';

const SAMPLES = path.join(__dirname, '..', '..', 'samples');
const indexMd = vscode.Uri.file(path.join(SAMPLES, 'index.md'));

async function closeEverything(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await waitFor('all editors closed', () => vscode.window.tabGroups.all.every((g) => g.tabs.length === 0));
}

function activeTab(): vscode.Tab | undefined {
  return vscode.window.tabGroups.activeTabGroup.activeTab;
}

function describeTab(tab: vscode.Tab | undefined): string {
  if (!tab) {
    return '<no tab>';
  }
  const input = tab.input as any;
  return `${tab.label} [${input?.constructor?.name}${input?.viewType ? ` ${input.viewType}` : ''}]`;
}

test('opening a .md file lands in the mdExplorer preview, not a text editor', async () => {
  await closeEverything();
  await vscode.commands.executeCommand('vscode.open', indexMd);

  const tab = await waitFor('a tab to appear', () => activeTab());
  assert.ok(
    tab.input instanceof vscode.TabInputWebview,
    `expected a webview tab, got ${describeTab(tab)}`
  );
  assert.match((tab.input as vscode.TabInputWebview).viewType, /mdExplorer\.preview/);
  assert.equal(tab.label, 'index.md');
});

test('the relay tab does not linger', async () => {
  const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs);
  const relays = tabs.filter(
    (tab) => tab.input instanceof vscode.TabInputCustom && tab.input.viewType.includes('mdExplorer.redirect')
  );
  assert.equal(relays.length, 0, `relay tabs left open: ${relays.map(describeTab).join(', ')}`);
  assert.equal(tabs.length, 1, `expected exactly one tab, got: ${tabs.map(describeTab).join(', ')}`);
});

test('a workbench.editorAssociations override for *.md still ends in a preview', async () => {
  const config = vscode.workspace.getConfiguration();
  await config.update(
    'workbench.editorAssociations',
    { '*.md': 'default' },
    vscode.ConfigurationTarget.Global
  );
  try {
    await closeEverything();
    await vscode.commands.executeCommand('vscode.open', indexMd);

    const tab = await waitFor('a preview despite the association', () => {
      const candidate = activeTab();
      return candidate?.input instanceof vscode.TabInputWebview ? candidate : undefined;
    });
    assert.equal(tab.label, 'index.md');
  } finally {
    await config.update(
      'workbench.editorAssociations',
      undefined,
      vscode.ConfigurationTarget.Global
    );
  }
});

test('the preview page itself loads and reports back', async () => {
  await closeEverything();
  await vscode.commands.executeCommand('vscode.open', indexMd);
  await waitFor('a preview', () => getApi().activePreview);
  await waitFor(
    'the preview page to finish loading',
    () => getApi().activePreview?.isReady,
    15000
  );
});

test('a preview asks for the webview find widget, so Ctrl+F works', async () => {
  await closeEverything();
  await vscode.commands.executeCommand('vscode.open', indexMd);
  const preview = await waitFor('a preview', () => getApi().previews[0]);
  assert.equal(preview.findWidget, true);
});
