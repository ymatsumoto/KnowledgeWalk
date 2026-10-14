import * as vscode from 'vscode';
import type { PreviewManager } from './previewManager';
import type { EditModeTracker } from './editModeTracker';
import { isMarkdownUri } from './markdownUri';
import { showLog } from './log';

/** Resolve the Markdown file a "show preview" invocation should act on. */
function targetUri(argument?: vscode.Uri): vscode.Uri | undefined {
  if (argument instanceof vscode.Uri && isMarkdownUri(argument)) {
    return argument;
  }
  const editor = vscode.window.activeTextEditor;
  if (editor && (editor.document.languageId === 'markdown' || isMarkdownUri(editor.document.uri))) {
    return editor.document.uri;
  }
  return undefined;
}

/**
 * The line the reader is on in `uri`'s text editor, so a preview opened from an editor
 * lands on the passage they were editing rather than at the top of the file.
 */
function cursorLine(uri: vscode.Uri): number | undefined {
  const key = uri.toString();
  const editor = vscode.window.visibleTextEditors.find(
    (candidate) => candidate.document.uri.toString() === key
  );
  return editor?.selection.active.line;
}

/** Close the text editor tab showing `uri`, if there is one. */
async function closeTextEditorTab(uri: vscode.Uri): Promise<void> {
  const key = uri.toString();
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === key) {
        await vscode.window.tabGroups.close(tab, true);
        return;
      }
    }
  }
}

export function registerCommands(
  context: vscode.ExtensionContext,
  manager: PreviewManager,
  editing: EditModeTracker
): void {
  const register = (id: string, handler: (...args: any[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));

  register('knowledgeWalk.goBack', () => manager.active?.goBack());
  register('knowledgeWalk.goForward', () => manager.active?.goForward());
  register('knowledgeWalk.refresh', () => manager.active?.refresh());
  register('knowledgeWalk.switchToEditor', () => manager.active?.switchToEditor());

  register('knowledgeWalk.showLog', () => showLog());

  register('knowledgeWalk.showPreview', async (argument?: vscode.Uri) => {
    const uri = targetUri(argument);
    if (!uri) {
      return;
    }
    const editor = vscode.window.activeTextEditor;
    const isActiveDocument = editor?.document.uri.toString() === uri.toString();
    const column = (isActiveDocument ? editor?.viewColumn : undefined) ?? vscode.ViewColumn.Active;

    // Mirror of switchToEditor: open the preview first so it inherits the tab slot,
    // then close the text editor that was there.
    manager.open(uri, column, undefined, cursorLine(uri));
    if (isActiveDocument) {
      await closeTextEditorTab(uri);
    }
  });

  register('knowledgeWalk.showPreviewToSide', (argument?: vscode.Uri) => {
    const uri = targetUri(argument);
    if (uri) {
      // The editor stays open next to the preview, so it keeps its edit-mode claim.
      manager.openBeside(uri, undefined, cursorLine(uri));
      editing.mark(uri);
    }
  });
}
