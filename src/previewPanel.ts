import * as vscode from 'vscode';
import * as path from 'path';
import type { FromWebview, LinkKind, NavMode, PreviewState, ToWebview } from './protocol';
import type { PreviewSnapshot } from './api';
import { NavigationHistory } from './history';
import { readConfig, toWebviewConfig } from './config';
import { readDocumentText } from './documentText';
import { classifyLink } from './renderer/linkRewrite';
import { escapeHtml } from './renderer/highlight';
import { buildPreviewHtml } from './webviewHtml';
import { log } from './log';
import type { WikiLinkIndex } from './wikiIndex';
import type { OkfService } from './okf/service';

/**
 * One Alt+Left can reach us twice: VS Code resolves the contributed keybinding, and the
 * webview's own key handler posts a message. Two navigations from *different* sources
 * inside this window are treated as one keypress. Repeats from the same source — a
 * reader clicking the Back button twice — always go through.
 */
const NAV_DEBOUNCE_MS = 150;

type NavSource = 'command' | 'webview';

/**
 * Two clicks in the same spot are a double-click, and following links means clicking in
 * the same spot twice — wiki navigation sits in the same place on every page. By the time
 * the second click lands the first one has already replaced the document, so it hits body
 * text rather than the link, and "double-click to edit" fires in the middle of a
 * navigation. Ignore the gesture for a moment after any navigation.
 */
const EDIT_GESTURE_GUARD_MS = 700;

let renderErrors = 0;

/** Documents that failed to render since activation; surfaced through the API. */
export function renderErrorCount(): number {
  return renderErrors;
}

export interface PreviewHost {
  /** Open a URI in a preview beside the current editor group. */
  openBeside(uri: vscode.Uri, fragment?: string): void;
  /**
   * Open a URI in a new preview tab in the same group, without taking focus — what a
   * browser does for a ctrl-click or a middle-click.
   */
  openInNewTab(uri: vscode.Uri, column: vscode.ViewColumn, fragment?: string): void;
  /** Workspace file index, needed to resolve `[[wiki links]]` by name. */
  readonly wikiIndex: WikiLinkIndex;
  /** Bundle roots and file existence for front matter and `/` links. */
  readonly okf: OkfService;
  /** Record that the reader wants this file in a text editor, not a preview. */
  markEditing(uri: vscode.Uri): void;
}

/**
 * One preview tab. Unlike a custom editor it is a plain WebviewPanel, so its title can
 * follow the reader from file to file while the webview itself — and everything the
 * browser has already laid out — stays alive.
 */
export class PreviewPanel {
  static readonly viewType = 'mdExplorer.preview';

  private history: NavigationHistory;
  private ready = false;
  private pendingMode: NavMode | undefined;
  private lastMode: NavMode = 'push';
  private lastNav: { at: number; source: NavSource } | undefined;
  private lastNavigationAt = 0;
  private lastTitle = '';
  private lastScroll:
    | { mode: NavMode; scrollTop: number; anchored: boolean; final: boolean; at: number }
    | undefined;
  private renderCount = 0;
  /** The HTML most recently sent to the page; exposed through the API for tests. */
  private lastHtml: string | undefined;
  /** Latest reading position reported by the page; see the `position` message. */
  private lastPosition: { uri: string; line: number } | undefined;
  /** Source line the next render should aim at, set when the reader came from a cursor. */
  private pendingLine: number | undefined;
  private disposed = false;
  private readonly disposables: vscode.Disposable[] = [];

  private readonly onDidDisposeEmitter = new vscode.EventEmitter<void>();
  readonly onDidDispose = this.onDidDisposeEmitter.event;

  private readonly onDidChangeStateEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeState = this.onDidChangeStateEmitter.event;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly host: PreviewHost,
    history: NavigationHistory
  ) {
    this.history = history;
    this.panel.webview.options = {
      enableScripts: true,
      localResourceRoots: this.resourceRoots(this.currentUri),
    };
    this.panel.webview.html = buildPreviewHtml(
      this.panel.webview,
      this.extensionUri,
      toWebviewConfig(readConfig())
    );

    this.panel.webview.onDidReceiveMessage(
      (message: FromWebview) => this.handleMessage(message),
      undefined,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
    this.panel.onDidChangeViewState(
      () => this.onDidChangeStateEmitter.fire(),
      undefined,
      this.disposables
    );

    const uri = this.currentUri;
    if (uri) {
      this.setTitle(uri);
    }
  }

  static create(
    extensionUri: vscode.Uri,
    host: PreviewHost,
    uri: vscode.Uri,
    column: vscode.ViewColumn,
    fragment?: string,
    preserveFocus = false,
    line?: number
  ): PreviewPanel {
    const panel = vscode.window.createWebviewPanel(
      PreviewPanel.viewType,
      path.basename(uri.path) || uri.toString(),
      { viewColumn: column, preserveFocus },
      {
        enableScripts: true,
        // Ctrl+F. The editor's own find widget cannot reach into a webview, so a panel
        // has to ask for VS Code's webview find widget explicitly; the built-in Markdown
        // preview does the same. It is a WebviewPanelOption, so it can only be set here.
        enableFindWidget: true,
        retainContextWhenHidden: readConfig(uri).retainHiddenPreviews,
      }
    );
    const history = new NavigationHistory(readConfig(uri).maxHistoryLength);
    history.push(uri.toString(), fragment);

    const preview = new PreviewPanel(panel, extensionUri, host, history);
    preview.pendingMode = 'push';
    preview.pendingLine = line;
    return preview;
  }

  static restore(
    extensionUri: vscode.Uri,
    host: PreviewHost,
    panel: vscode.WebviewPanel,
    state: PreviewState | undefined
  ): PreviewPanel | undefined {
    const history = NavigationHistory.fromState(state, readConfig().maxHistoryLength);
    if (!history.current) {
      panel.dispose();
      return undefined;
    }
    if (!panel.options.enableFindWidget) {
      // enableFindWidget is a WebviewPanelOption, settable only at creation. If a
      // restored panel comes back without it, Ctrl+F is dead on that tab until it is
      // closed and reopened, and saying so beats leaving the reader guessing.
      log.warn('restored preview has no find widget; reopen the tab to get Ctrl+F back');
    }
    const preview = new PreviewPanel(panel, extensionUri, host, history);
    preview.pendingMode = 'refresh';
    return preview;
  }

  // ---------------------------------------------------------------- state

  get currentUri(): vscode.Uri | undefined {
    const entry = this.history.current;
    return entry ? vscode.Uri.parse(entry.uri) : undefined;
  }

  get isActive(): boolean {
    return this.panel.active;
  }

  get isVisible(): boolean {
    return this.panel.visible;
  }

  get canGoBack(): boolean {
    return this.history.canGoBack;
  }

  get canGoForward(): boolean {
    return this.history.canGoForward;
  }

  snapshot(): PreviewSnapshot {
    return {
      uri: this.currentUri?.toString() ?? '',
      title: this.lastTitle,
      canGoBack: this.canGoBack,
      canGoForward: this.canGoForward,
      historyLength: this.history.length,
      historyIndex: this.history.index,
      departureLinkId: this.history.current?.linkId,
      isActive: this.isActive,
      isReady: this.ready,
      lastScroll: this.lastScroll,
      renderCount: this.renderCount,
      findWidget: this.panel.options.enableFindWidget === true,
      line: this.positionInCurrentDocument(),
    };
  }

  /**
   * The reader's double-click on the page. Unlike the Open in Editor command this can
   * arrive as the tail of a link click, so it is guarded; see EDIT_GESTURE_GUARD_MS.
   */
  editGesture(line?: number): void {
    const sinceNavigation = Date.now() - this.lastNavigationAt;
    if (sinceNavigation < EDIT_GESTURE_GUARD_MS) {
      log.debug(`ignoring double-click to edit ${sinceNavigation}ms after a navigation`);
      return;
    }
    void this.switchToEditor(line);
  }

  /**
   * Follow a link from the document on screen, taking the same path a click in the
   * preview takes. Exposed through the extension API.
   */
  /** The page's current HTML, as rendered in the extension host. */
  renderedHtml(): string | undefined {
    return this.lastHtml;
  }

  /**
   * Follow the link the page rendered with `data-mdx-link="linkId"`, exactly as a click
   * on it would: with the target the renderer resolved, not one recomputed here.
   */
  clickRenderedLink(linkId: number, newTab = false): boolean {
    const html = this.lastHtml ?? '';
    const tag = new RegExp(`<a\\b[^>]*\\bdata-mdx-link="${linkId}"[^>]*>`).exec(html)?.[0];
    if (!tag) {
      return false;
    }
    const attr = (name: string) => {
      const value = new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
      return value === undefined ? undefined : decodeEntities(value);
    };
    this.handleNavigate({
      type: 'navigate',
      kind: (attr('data-mdx-kind') ?? 'unknown') as LinkKind,
      target: attr('data-mdx-target'),
      href: attr('data-mdx-href'),
      fragment: attr('data-mdx-fragment'),
      linkId,
      newTab,
    });
    return true;
  }

  followLink(href: string, linkId = 0, newTab = false): void {
    const base = this.currentUri;
    if (!base) {
      return;
    }
    const link = classifyLink(href, base);
    this.handleNavigate({
      type: 'navigate',
      kind: link.kind,
      target: link.target?.toString(),
      href: link.href,
      fragment: link.fragment,
      linkId,
      newTab,
    });
  }

  reveal(column?: vscode.ViewColumn, preserveFocus = false): void {
    this.panel.reveal(column ?? this.panel.viewColumn, preserveFocus);
  }

  // ----------------------------------------------------------- navigation

  goBack(source: NavSource = 'command'): void {
    if (this.isEchoOf(source) || !this.history.back()) {
      return;
    }
    void this.render('back');
  }

  goForward(source: NavSource = 'command'): void {
    if (this.isEchoOf(source) || !this.history.forward()) {
      return;
    }
    void this.render('forward');
  }

  refresh(): void {
    void this.render('refresh');
  }

  /** Re-render only if this tab is the one showing the given document. */
  refreshIfShowing(uri: vscode.Uri): void {
    if (this.currentUri?.toString() === uri.toString()) {
      void this.render('refresh');
    }
  }

  /**
   * Close the preview and open the same file in a plain text editor. The editor is
   * opened first so it takes the slot immediately to the right; disposing the preview
   * afterwards leaves the editor sitting exactly where the preview was.
   */
  async switchToEditor(line?: number): Promise<void> {
    const uri = this.currentUri;
    if (!uri) {
      return;
    }
    // A double-click names its own line; every other route — the title-bar button, the
    // context menu, the command palette — inherits wherever the reader had got to.
    const target = typeof line === 'number' ? line : this.positionInCurrentDocument();
    const options: vscode.TextDocumentShowOptions = {
      viewColumn: this.panel.viewColumn ?? vscode.ViewColumn.Active,
      preview: false,
    };
    if (typeof target === 'number' && Number.isFinite(target) && target >= 0) {
      options.selection = new vscode.Range(target, 0, target, 0);
    }
    // Claim the file for editing before opening it, so the reclaim safety net leaves
    // this editor alone. 'default' is VS Code's built-in text editor, so this also
    // bypasses the custom editor that owns *.md.
    this.host.markEditing(uri);
    await vscode.commands.executeCommand('vscode.openWith', uri, 'default', options);
    // `selection` only promises the line will be somewhere on screen — usually scrolled
    // to an edge. Centring it puts the passage back under the reader's eyes.
    const editor = vscode.window.activeTextEditor;
    if (options.selection && editor?.document.uri.toString() === uri.toString()) {
      editor.revealRange(options.selection, vscode.TextEditorRevealType.InCenter);
    }
    this.dispose();
  }

  /**
   * Scroll a tab that is already open to a source line — the reader pressed Open Preview
   * from an editor whose document this tab is showing.
   */
  revealLine(line: number): void {
    if (!Number.isFinite(line) || line < 0) {
      return;
    }
    if (!this.ready) {
      this.pendingLine = line;
      return;
    }
    const message: ToWebview = { type: 'revealLine', line };
    void this.panel.webview.postMessage(message);
  }

  /** Where the reader is in the document on screen, if the page has reported it yet. */
  private positionInCurrentDocument(): number | undefined {
    const uri = this.currentUri?.toString();
    return uri !== undefined && this.lastPosition?.uri === uri ? this.lastPosition.line : undefined;
  }

  /** True when this request is the second half of a single keypress. */
  private isEchoOf(source: NavSource): boolean {
    const now = Date.now();
    const previous = this.lastNav;
    this.lastNav = { at: now, source };
    return !!previous && previous.source !== source && now - previous.at < NAV_DEBOUNCE_MS;
  }

  // -------------------------------------------------------------- rendering

  private resourceRoots(uri?: vscode.Uri): vscode.Uri[] {
    const roots = [
      this.extensionUri,
      ...(vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri),
    ];
    if (uri && uri.scheme === 'file') {
      roots.push(uri.with({ path: path.posix.dirname(uri.path), query: '', fragment: '' }));
    }
    return roots;
  }

  private isRootCovered(uri: vscode.Uri): boolean {
    const directory = uri.with({ path: path.posix.dirname(uri.path), query: '', fragment: '' });
    const target = directory.toString();
    return (this.panel.webview.options.localResourceRoots ?? []).some((root) =>
      target.startsWith(root.toString())
    );
  }

  private async render(mode: NavMode): Promise<void> {
    const entry = this.history.current;
    if (!entry || this.disposed) {
      return;
    }
    this.lastMode = mode;
    if (mode !== 'refresh') {
      this.lastNavigationAt = Date.now();
    }

    const uri = vscode.Uri.parse(entry.uri);
    // Rename the tab up front: the label must match the document even while the page
    // itself is still loading.
    this.setTitle(uri);

    if (!this.ready) {
      this.pendingMode = mode;
      return;
    }

    // Widen the sandbox only when a document outside the current roots is reached, so
    // images next to a file outside the workspace still load.
    if (!this.isRootCovered(uri)) {
      this.panel.webview.options = {
        enableScripts: true,
        localResourceRoots: [
          ...(this.panel.webview.options.localResourceRoots ?? []),
          ...this.resourceRoots(uri),
        ],
      };
    }

    const cfg = readConfig(uri);
    this.history.setMaxLength(cfg.maxHistoryLength);

    let html: string;
    try {
      const [text, renderer] = await Promise.all([
        readDocumentText(uri),
        // Loaded on demand: markdown-it, highlight.js and KaTeX together are the bulk of
        // the extension bundle, and activation should not pay for them.
        import('./renderer/markdown'),
        // Warmed alongside the read; prepare() below needs it, and so do wiki links.
        this.host.wikiIndex.ensure(),
      ]);
      // The reader can close the tab, or switch to the editor, while we are reading.
      // Touching the panel after that throws, so bail at every await boundary — this is
      // not a render failure and must not be counted as one.
      if (this.disposed) {
        return;
      }
      // Roots, front matter and every file the document mentions are looked up now, so
      // the render itself can stay synchronous.
      const prepared = await this.host.okf.prepare(uri, text);
      if (this.disposed) {
        return;
      }
      html = renderer.renderMarkdown(text, cfg, {
        docUri: uri,
        webview: this.panel.webview,
        wikiIndex: this.host.wikiIndex,
        wikiRoot: prepared.roots.wikiRoot,
        prepared,
      });
    } catch (error) {
      if (this.disposed) {
        return;
      }
      renderErrors += 1;
      log.error(`could not render ${uri.fsPath}`, error);
      html = this.errorHtml(uri, error);
    }
    if (this.disposed) {
      return;
    }

    const message: ToWebview = {
      type: 'render',
      html,
      uri: uri.toString(),
      mode,
      fragment: entry.fragment,
      linkId: entry.linkId,
      canGoBack: this.canGoBack,
      canGoForward: this.canGoForward,
      config: toWebviewConfig(cfg),
      state: this.history.snapshot(),
      line: this.pendingLine,
    };
    this.renderCount += 1;
    this.lastHtml = html;
    // Aiming at a line is a one-off: a refresh or a link followed later must not drag
    // the reader back to where they entered the document.
    this.pendingLine = undefined;
    await this.panel.webview.postMessage(message);
    this.onDidChangeStateEmitter.fire();
  }

  private setTitle(uri: vscode.Uri): void {
    this.lastTitle = path.basename(uri.path) || uri.toString();
    this.panel.title = this.lastTitle;
  }

  private errorHtml(uri: vscode.Uri, error: unknown): string {
    const detail = error instanceof Error ? error.message : String(error);
    return `<div class="mdx-error"><h1>Cannot open this document</h1><p><code>${escapeHtml(
      uri.fsPath || uri.toString()
    )}</code></p><p>${escapeHtml(detail)}</p></div>`;
  }

  // --------------------------------------------------------------- messages

  private handleMessage(message: FromWebview): void {
    switch (message.type) {
      case 'ready': {
        this.ready = true;
        const mode = this.pendingMode ?? this.lastMode;
        this.pendingMode = undefined;
        void this.render(mode);
        return;
      }
      case 'back':
        this.goBack('webview');
        return;
      case 'forward':
        this.goForward('webview');
        return;
      case 'switchToEditor':
        this.editGesture(message.line);
        return;
      case 'pageError':
        log.error(`preview page error: ${message.message}`, message.stack ?? '');
        return;
      case 'navigate':
        this.handleNavigate(message);
        return;
      case 'position':
        this.lastPosition = { uri: message.uri, line: message.line };
        return;
      case 'settled':
        this.lastScroll = {
          mode: message.mode,
          scrollTop: message.scrollTop,
          anchored: message.anchored,
          final: message.final,
          at: Date.now(),
        };
        this.onDidChangeStateEmitter.fire();
        return;
    }
  }

  private handleNavigate(message: Extract<FromWebview, { type: 'navigate' }>): void {
    log.debug(`navigate ${message.kind} -> ${message.target ?? message.href ?? '?'}`);
    if (message.kind === 'external') {
      if (message.href) {
        void vscode.env.openExternal(vscode.Uri.parse(message.href));
      }
      return;
    }
    if (!message.target) {
      return;
    }
    const target = vscode.Uri.parse(message.target);

    if (message.kind === 'file') {
      void vscode.commands.executeCommand('vscode.open', target, {
        viewColumn: this.panel.viewColumn,
      });
      return;
    }

    if (message.newTab) {
      this.host.openInNewTab(
        target,
        this.panel.viewColumn ?? vscode.ViewColumn.Active,
        message.fragment
      );
      // `preserveFocus` keeps the new webview from taking keyboard focus but VS Code
      // still makes its tab the active one, so step back to where the reader was: the
      // point of a ctrl-click is not to interrupt them.
      this.reveal();
      return;
    }

    // 'markdown' and 'anchor' both become history entries, so Back returns to the link.
    this.history.push(target.toString(), message.fragment, message.linkId);
    void this.render('push');
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.onDidDisposeEmitter.fire();
    this.onDidDisposeEmitter.dispose();
    this.onDidChangeStateEmitter.dispose();
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
    this.panel.dispose();
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
