import * as vscode from 'vscode';
import type { PreviewManager } from './previewManager';
import { isMarkdownUri } from './markdownUri';

const DEBOUNCE_MS = 300;

/**
 * Keep open previews in step with the file on disk and with unsaved edits made in a
 * split text editor. Changes are coalesced so typing does not re-render on every stroke.
 */
export function registerWatchers(
  context: vscode.ExtensionContext,
  manager: PreviewManager
): void {
  const pending = new Map<string, NodeJS.Timeout>();

  const schedule = (uri: vscode.Uri) => {
    // Every keystroke in every open document reaches onDidChangeTextDocument; only the
    // files a preview is actually showing are worth a timer.
    if (!isMarkdownUri(uri) || !manager.isShowing(uri)) {
      return;
    }
    const key = uri.toString();
    const existing = pending.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    pending.set(
      key,
      setTimeout(() => {
        pending.delete(key);
        manager.refresh(uri);
      }, DEBOUNCE_MS)
    );
  };

  const watcher = vscode.workspace.createFileSystemWatcher('**/*.{md,markdown,mdown,mkd,mkdn}');

  context.subscriptions.push(
    watcher,
    watcher.onDidChange(schedule),
    watcher.onDidCreate(schedule),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.contentChanges.length > 0) {
        schedule(event.document.uri);
      }
    }),
    vscode.workspace.onDidSaveTextDocument((document) => schedule(document.uri)),
    new vscode.Disposable(() => {
      for (const timer of pending.values()) {
        clearTimeout(timer);
      }
      pending.clear();
    })
  );
}
