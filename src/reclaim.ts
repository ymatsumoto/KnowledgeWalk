import * as vscode from 'vscode';
import { readConfig } from './config';
import type { EditModeTracker } from './editModeTracker';
import type { PreviewManager } from './previewManager';
import { isMarkdownUri } from './markdownUri';

/**
 * Safety net for requirement "a .md file opens as a preview, never as text".
 *
 * The custom editor registered as the default for `*.md` handles the normal case, but it
 * is not the only way a Markdown text editor can appear: tabs restored from a session
 * that predates this extension come back as text editors, and a
 * `workbench.editorAssociations` entry for `*.md` overrides the custom editor outright.
 * This turns any such stray editor into a preview, leaving alone the files the reader
 * explicitly asked to edit.
 */
export function registerReclaim(
  context: vscode.ExtensionContext,
  manager: PreviewManager,
  editing: EditModeTracker
): void {
  const reclaim = () => {
    if (!readConfig().reclaimTextEditors) {
      return;
    }
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        // Only plain text editors: diff, merge and notebook views are left alone.
        if (!(input instanceof vscode.TabInputText)) {
          continue;
        }
        const uri = input.uri;
        if (uri.scheme !== 'file' || !isMarkdownUri(uri) || editing.isEditing(uri)) {
          continue;
        }
        manager.open(uri, group.viewColumn);
        void vscode.window.tabGroups.close(tab, true);
      }
    }
  };

  // Catch editors restored before the extension was activated, then anything new.
  reclaim();
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs((event) => {
      if (event.opened.length > 0 || event.changed.length > 0) {
        reclaim();
      }
      // A file is only "being edited" while its editor is open.
      for (const tab of event.closed) {
        if (tab.input instanceof vscode.TabInputText) {
          editing.unmark(tab.input.uri);
        }
      }
    })
  );
}
