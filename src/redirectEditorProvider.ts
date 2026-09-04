import * as vscode from 'vscode';
import type { PreviewManager } from './previewManager';

/**
 * A no-op custom editor registered as the *default* editor for `*.md`.
 *
 * Its only job is to catch every route that opens a Markdown file — Explorer clicks,
 * Quick Open, `vscode.open` from other extensions, drag and drop — and hand the file to
 * a real webview panel instead. The relay tab is closed immediately afterwards.
 *
 * The detour exists because VS Code pins a custom editor's tab title to its resource and
 * offers no way to change it (microsoft/vscode#160543), which would leave the tab reading
 * `a.md` after the reader followed a link to `b.md`. A plain WebviewPanel has a writable
 * title, so navigation can rename the tab as the reader moves.
 */
export class RedirectEditorProvider implements vscode.CustomReadonlyEditorProvider {
  static readonly viewType = 'mdExplorer.redirect';

  constructor(private readonly manager: PreviewManager) {}

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => undefined };
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel
  ): Promise<void> {
    // Deliberately no html and no options: the relay is closed again within a couple of
    // frames, and giving it content only makes VS Code boot an iframe it will discard.
    const column = webviewPanel.viewColumn ?? vscode.ViewColumn.Active;

    // Open the real preview first: it lands immediately to the right of the relay tab,
    // so closing the relay leaves the preview in the slot the user clicked into.
    this.manager.open(document.uri, column);
    // Not awaited: resolveCustomEditor should return as soon as the hand-off is started.
    void this.closeRelayTab(document.uri, webviewPanel);
  }

  private async closeRelayTab(uri: vscode.Uri, panel: vscode.WebviewPanel): Promise<void> {
    const key = uri.toString();
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (
          input instanceof vscode.TabInputCustom &&
          input.viewType === RedirectEditorProvider.viewType &&
          input.uri.toString() === key
        ) {
          await vscode.window.tabGroups.close(tab, true);
          return;
        }
      }
    }
    // Fallback for hosts where the tab is not yet registered when we get here.
    panel.dispose();
  }
}
