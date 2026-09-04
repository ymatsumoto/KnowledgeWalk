import * as vscode from 'vscode';

const STORAGE_KEY = 'mdExplorer.editing';

/**
 * Remembers which Markdown files the reader deliberately wants in a text editor.
 *
 * Without this there is no way to tell "the user asked to edit this" from "something
 * opened this as text against our wishes" — both simply look like a text editor tab
 * appearing. The set is persisted so an editing session survives a window reload.
 */
export class EditModeTracker {
  private readonly editing: Set<string>;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.editing = new Set(context.workspaceState.get<string[]>(STORAGE_KEY, []));
  }

  isEditing(uri: vscode.Uri): boolean {
    return this.editing.has(uri.toString());
  }

  mark(uri: vscode.Uri): void {
    const key = uri.toString();
    if (this.editing.has(key)) {
      return;
    }
    this.editing.add(key);
    void this.persist();
  }

  unmark(uri: vscode.Uri): void {
    if (this.editing.delete(uri.toString())) {
      void this.persist();
    }
  }

  private persist(): Thenable<void> {
    return this.context.workspaceState.update(STORAGE_KEY, [...this.editing]);
  }
}
