import type * as vscode from 'vscode';

/** A read-only view of one preview tab, as returned by the extension's exported API. */
export interface PreviewSnapshot {
  /** Serialised URI of the document the tab is currently showing. */
  uri: string;
  /** The tab's label, which follows the document as the reader navigates. */
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  historyLength: number;
  historyIndex: number;
  /** Link followed out of the current entry: where Back will scroll to. */
  departureLinkId: number | undefined;
  isActive: boolean;
  /** True once the preview page has loaded and is receiving content. */
  isReady: boolean;
  /** Where the page settled after the most recent navigation. */
  lastScroll:
    | { mode: string; scrollTop: number; anchored: boolean; final: boolean; at: number }
    | undefined;
  /** Number of renders this tab has performed; useful for diagnosing extra work. */
  renderCount: number;
  /** Whether Ctrl+F opens VS Code's find widget over this tab. */
  findWidget: boolean;
  /** Source line the reader is on, as last reported by the page. */
  line?: number;
}

/**
 * Returned from `activate`, so other extensions — and the integration tests — can drive
 * a preview through exactly the code paths a reader's clicks go through.
 */
export interface KnowledgeWalkApi {
  readonly previews: PreviewSnapshot[];
  /**
   * How many documents have failed to render since activation. A preview that fails
   * still shows a tab with a title and a working history, so this is the only way to
   * notice from the outside.
   */
  readonly renderErrors: number;
  readonly activePreview: PreviewSnapshot | undefined;
  openPreview(uri: vscode.Uri, column?: vscode.ViewColumn): void;
  /**
   * Follow a link from the focused preview, as clicking it in the page would.
   * `newTab` mirrors a ctrl-click or middle-click.
   */
  followLink(href: string, linkId?: number, newTab?: boolean): void;
  /**
   * Click the link the focused preview rendered as `data-mdx-link="linkId"`, using the
   * target the renderer resolved. Returns false when there is no such link.
   */
  clickRenderedLink(linkId: number, newTab?: boolean): boolean;
  /** What hovering a link to `target` (a serialised URI) shows in the focused preview. */
  peek(target: string): Promise<{ found: boolean; title?: string; description?: string } | undefined>;
  /** The focused preview's HTML as last rendered in the extension host. */
  renderedHtml(): string | undefined;
  /** Double-click the page, as a reader switching to the editor would. */
  editGesture(line?: number): void;
  goBack(): void;
  goForward(): void;
}
