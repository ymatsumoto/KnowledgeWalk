import * as vscode from 'vscode';
import type { PreviewState } from './protocol';
import { PreviewPanel, type PreviewHost } from './previewPanel';
import type { EditModeTracker } from './editModeTracker';
import type { WikiLinkIndex } from './wikiIndex';
import type { OkfService } from './okf/service';

/**
 * Owns every open preview tab, decides whether a request opens a new tab or reveals an
 * existing one, and keeps the `mdExplorer.canGoBack` / `canGoForward` context keys in
 * sync with whichever preview is focused.
 */
export class PreviewManager implements vscode.Disposable, PreviewHost {
  private readonly panels = new Set<PreviewPanel>();
  private activePanel: PreviewPanel | undefined;
  private lastFocused: PreviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly editing: EditModeTracker,
    readonly wikiIndex: WikiLinkIndex,
    readonly okf: OkfService
  ) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.syncActive()),
      vscode.window.tabGroups.onDidChangeTabs(() => this.syncActive())
    );
  }

  get active(): PreviewPanel | undefined {
    return this.activePanel;
  }

  get all(): PreviewPanel[] {
    return [...this.panels];
  }

  /**
   * Show `uri` as a preview. A tab already displaying that exact document is reused,
   * so re-opening a file never leaves duplicate tabs behind; anything else gets a tab
   * of its own.
   */
  open(
    uri: vscode.Uri,
    column: vscode.ViewColumn,
    fragment?: string,
    line?: number
  ): PreviewPanel {
    // Opening a preview means the reader is no longer editing this file.
    this.editing.unmark(uri);
    const existing = this.find(uri);
    if (existing) {
      existing.reveal(column);
      if (typeof line === 'number') {
        existing.revealLine(line);
      }
      return existing;
    }
    return this.track(
      PreviewPanel.create(this.extensionUri, this, uri, column, fragment, false, line)
    );
  }

  markEditing(uri: vscode.Uri): void {
    this.editing.mark(uri);
  }

  /**
   * A browser's ctrl-click: a new tab next to the current one that does not steal focus,
   * so the reader can keep going and come back to it later. An existing tab for the same
   * document is revealed instead of duplicated.
   */
  openInNewTab(uri: vscode.Uri, column: vscode.ViewColumn, fragment?: string): void {
    const existing = this.find(uri);
    if (existing) {
      existing.reveal(column, true);
      return;
    }
    this.editing.unmark(uri);
    this.track(PreviewPanel.create(this.extensionUri, this, uri, column, fragment, true));
  }

  openBeside(uri: vscode.Uri, fragment?: string, line?: number): void {
    const existing = this.find(uri);
    if (existing) {
      existing.reveal();
      if (typeof line === 'number') {
        existing.revealLine(line);
      }
      return;
    }
    this.track(
      PreviewPanel.create(
        this.extensionUri,
        this,
        uri,
        vscode.ViewColumn.Beside,
        fragment,
        false,
        line
      )
    );
  }

  restore(panel: vscode.WebviewPanel, state: PreviewState | undefined): void {
    const preview = PreviewPanel.restore(this.extensionUri, this, panel, state);
    if (preview) {
      this.track(preview);
    }
  }

  /** Re-render every tab that is currently showing the changed document. */
  refresh(uri: vscode.Uri): void {
    for (const panel of this.panels) {
      panel.refreshIfShowing(uri);
    }
  }

  /** True when some tab is currently showing this document. */
  isShowing(uri: vscode.Uri): boolean {
    return this.find(uri) !== undefined;
  }

  /** Re-render every tab, e.g. after a settings change. */
  refreshAll(): void {
    for (const panel of this.panels) {
      panel.refresh();
    }
  }

  private find(uri: vscode.Uri): PreviewPanel | undefined {
    const key = uri.toString();
    for (const panel of this.panels) {
      if (panel.currentUri?.toString() === key) {
        return panel;
      }
    }
    return undefined;
  }

  private track(panel: PreviewPanel): PreviewPanel {
    this.panels.add(panel);
    panel.onDidDispose(() => {
      this.panels.delete(panel);
      if (this.activePanel === panel) {
        this.activePanel = undefined;
      }
      if (this.lastFocused === panel) {
        this.lastFocused = undefined;
      }
      this.syncActive();
    });
    panel.onDidChangeState(() => this.syncActive());
    this.syncActive();
    return panel;
  }

  private syncActive(): void {
    let focused: PreviewPanel | undefined;
    for (const panel of this.panels) {
      if (panel.isActive) {
        focused = panel;
        break;
      }
    }
    if (focused) {
      this.lastFocused = focused;
    }

    /*
     * `WebviewPanel.active` means the webview has keyboard focus, but VS Code keeps
     * treating a preview as the *active editor* after focus moves elsewhere — and
     * clicking a button in the editor's own title bar is exactly such a move. Commands
     * fired from those buttons would otherwise find no panel to act on, so fall back to
     * the preview that had focus last, for as long as it is still on screen.
     */
    const active =
      focused ??
      (this.lastFocused && this.panels.has(this.lastFocused) && this.lastFocused.isVisible
        ? this.lastFocused
        : undefined);
    this.activePanel = active;
    void vscode.commands.executeCommand('setContext', 'mdExplorer.canGoBack', !!active?.canGoBack);
    void vscode.commands.executeCommand(
      'setContext',
      'mdExplorer.canGoForward',
      !!active?.canGoForward
    );
  }

  dispose(): void {
    for (const d of this.disposables.splice(0)) {
      d.dispose();
    }
    for (const panel of [...this.panels]) {
      panel.dispose();
    }
  }
}
