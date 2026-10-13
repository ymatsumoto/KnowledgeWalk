/**
 * Message shapes shared between the extension host and the preview webview.
 * Both bundles import this file, so the two sides can never drift apart.
 */

export type LinkKind = 'anchor' | 'markdown' | 'file' | 'external' | 'unknown';

/**
 * How the current page was reached. Drives the scroll behaviour in the webview:
 * `push` and `forward` land at the top of the page, `back` puts the link that was
 * followed at the top, and `refresh` keeps the reader where they were.
 */
export type NavMode = 'push' | 'back' | 'forward' | 'refresh';

export interface HistoryEntry {
  /** Serialised URI of the document shown by this entry. */
  uri: string;
  /** `#fragment` this entry should scroll to when it is first opened. */
  fragment?: string;
  /** Id of the link that was followed *out of* this entry, used to restore position on `back`. */
  linkId?: number;
}

export interface PreviewState {
  history: HistoryEntry[];
  index: number;
  /** Maintained by the webview, so a reloaded page returns to the same offset. */
  scrollTop?: number;
}

export interface WebviewConfig {
  doubleClickToEdit: boolean;
  mermaid: boolean;
  scrollOffset: number;
}

/** Host -> webview. */
export type ToWebview =
  | {
      type: 'render';
      html: string;
      uri: string;
      mode: NavMode;
      fragment?: string;
      linkId?: number;
      canGoBack: boolean;
      canGoForward: boolean;
      config: WebviewConfig;
      state: PreviewState;
      /** Source line to open at, when the reader came from a cursor in the editor. */
      line?: number;
    }
  | { type: 'config'; config: WebviewConfig }
  /** Scroll an already-rendered page to a source line; the tab was reused. */
  | { type: 'revealLine'; line: number };

/** Webview -> host. */
export type FromWebview =
  | { type: 'ready' }
  | {
      type: 'navigate';
      kind: LinkKind;
      /** Serialised URI for `markdown` / `file` / `anchor` links. */
      target?: string;
      /** Raw href for `external` links. */
      href?: string;
      fragment?: string;
      /** Index of the clicked anchor within the current document. */
      linkId: number;
      newTab?: boolean;
    }
  | { type: 'switchToEditor'; line?: number }
  | {
      /**
       * Where the reader is in the document, as a source line: the block holding the
       * selection, or the one at the top of the viewport. Reported as they read, so a
       * switch to the editor can land on the same passage without a round trip.
       */
      type: 'position';
      uri: string;
      line: number;
    }
  | { type: 'pageError'; message: string; stack?: string }
  | { type: 'back' }
  | { type: 'forward' }
  | {
      /** Where the page came to rest after a navigation. */
      type: 'settled';
      uri: string;
      mode: NavMode;
      scrollTop: number;
      /** Whether the element the mode asked for (link or heading) was found. */
      anchored: boolean;
      /** False for the first report, which lands before late reflows have finished. */
      final: boolean;
    };
