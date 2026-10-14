import DOMPurify from 'dompurify';
import type { FromWebview, NavMode, ToWebview, WebviewConfig, PreviewState } from '../src/protocol';

declare function acquireVsCodeApi(): {
  postMessage(message: FromWebview): void;
  getState(): PreviewState | undefined;
  setState(state: PreviewState): void;
};

interface Bootstrap {
  config: WebviewConfig;
  mermaidUri: string;
  katexCssUri: string;
  nonce: string;
}

const bootstrap: Bootstrap = (window as any).MDX_BOOTSTRAP;
const vscodeApi = acquireVsCodeApi();
const content = document.getElementById('mdx-content') as HTMLElement;

let config: WebviewConfig = bootstrap.config;
let canGoBack = false;
let canGoForward = false;
/** Bumped on every render so a stale scroll-settling loop stops touching the page. */
let renderToken = 0;
let persisted: PreviewState | undefined = vscodeApi.getState();
/** The document currently rendered, so a position report can name what it refers to. */
let currentUri = '';
let currentMode: NavMode = 'push';
/** The first render after a page load restores the offset instead of jumping to the top. */
let isFirstRender = true;

function persist(state: PreviewState): void {
  persisted = { ...state, scrollTop: Math.round(window.scrollY) };
  vscodeApi.setState(persisted);
}

let scrollPersistTimer = 0;
window.addEventListener(
  'scroll',
  () => {
    if (!persisted || scrollPersistTimer) {
      return;
    }
    scrollPersistTimer = window.setTimeout(() => {
      scrollPersistTimer = 0;
      if (persisted) {
        persisted.scrollTop = Math.round(window.scrollY);
        vscodeApi.setState(persisted);
      }
    }, 300);
  },
  { passive: true }
);

/**
 * KaTeX ships 23 KB of CSS plus web fonts. Most documents contain no math, so the
 * stylesheet is attached the first time a rendered page actually uses it.
 */
let katexCssAttached = false;
function ensureKatexStyles(): void {
  if (katexCssAttached || !content.querySelector('.katex')) {
    return;
  }
  katexCssAttached = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = bootstrap.katexCssUri;
  document.head.appendChild(link);
}

function post(message: FromWebview): void {
  vscodeApi.postMessage(message);
}

// ---------------------------------------------------------------- rendering

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
    ADD_ATTR: ['target', 'align', 'start', 'colspan', 'rowspan'],
  });
}

function updateContextMenu(): void {
  document.body.dataset.vscodeContext = JSON.stringify({
    webviewSection: 'body',
    preventDefaultContextMenuItems: false,
    mdxCanGoBack: canGoBack,
    mdxCanGoForward: canGoForward,
  });
}

async function render(message: Extract<ToWebview, { type: 'render' }>): Promise<void> {
  const token = ++renderToken;
  peek.reset();
  config = message.config;
  currentUri = message.uri;
  currentMode = message.mode;
  canGoBack = message.canGoBack;
  canGoForward = message.canGoForward;
  updateContextMenu();

  const previousScroll = isFirstRender ? (persisted?.scrollTop ?? 0) : window.scrollY;
  content.innerHTML = sanitize(message.html);
  ensureKatexStyles();
  persist(message.state);
  isFirstRender = false;

  await renderMermaid(token);
  if (token !== renderToken) {
    return;
  }

  settleScroll(token, message, () => resolveScrollTarget(message, previousScroll));
}

/**
 * Where the page should sit after this navigation.
 *
 *  - `back`    -> the link that was followed out of this page, back at the top
 *  - `forward` -> the top of the page
 *  - `push`    -> the top, or the linked `#fragment`
 *  - `refresh` -> wherever the reader already was
 */
function resolveScrollTarget(
  message: Extract<ToWebview, { type: 'render' }>,
  previousScroll: number
): { top: number; anchored: boolean } {
  if (typeof message.line === 'number') {
    const block = blockForLine(message.line);
    if (block) {
      return { top: centerOf(block), anchored: true };
    }
  }
  if (message.mode === 'refresh') {
    return { top: previousScroll, anchored: true };
  }
  if (message.mode === 'back' && typeof message.linkId === 'number') {
    const link = content.querySelector(`[data-mdx-link="${message.linkId}"]`);
    if (link) {
      return { top: offsetTopOf(link), anchored: true };
    }
  }
  if (message.mode === 'push' && message.fragment) {
    const anchor = findAnchor(message.fragment);
    if (anchor) {
      return { top: offsetTopOf(anchor), anchored: true };
    }
  }
  // Forward always goes to the top by design; anything else reaching here was asked to
  // aim at something and could not find it.
  const wasAskedForTarget =
    (message.mode === 'back' && typeof message.linkId === 'number') ||
    (message.mode === 'push' && !!message.fragment) ||
    typeof message.line === 'number';
  return { top: 0, anchored: !wasAskedForTarget };
}

/**
 * The block that renders `line` of the source.
 *
 * `data-line` sits on block-level tokens only, so a line inside a paragraph resolves to
 * the paragraph: the last block that starts at or before it. That is the same
 * granularity VS Code's own Markdown preview syncs at.
 */
function blockForLine(line: number): Element | undefined {
  let match: Element | undefined;
  for (const block of Array.from(content.querySelectorAll<HTMLElement>('[data-line]'))) {
    const start = Number(block.dataset.line);
    if (!Number.isFinite(start) || start > line) {
      break;
    }
    match = block;
  }
  return match ?? content.querySelector('[data-line]') ?? undefined;
}

/** The source line the reader is looking at: their selection, else the top of the view. */
function currentLine(): number | undefined {
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const node = selection.getRangeAt(0).startContainer;
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    const block = element?.closest<HTMLElement>('[data-line]');
    // A collapsed selection is just a caret the reader left behind by clicking, which is
    // still a better answer than the top of the viewport only when it is on screen.
    if (block && (!selection.isCollapsed || isOnScreen(block))) {
      const line = Number(block.dataset.line);
      if (Number.isFinite(line)) {
        return line;
      }
    }
  }

  for (const block of Array.from(content.querySelectorAll<HTMLElement>('[data-line]'))) {
    if (block.getBoundingClientRect().bottom > config.scrollOffset) {
      const line = Number(block.dataset.line);
      return Number.isFinite(line) ? line : undefined;
    }
  }
  return undefined;
}

function isOnScreen(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < window.innerHeight;
}

let positionTimer = 0;
/**
 * Report where the reader is, so switching to the editor can land on the same passage.
 * Debounced: this rides the scroll event, and the host only ever needs the latest value.
 */
function reportPosition(): void {
  if (positionTimer) {
    return;
  }
  positionTimer = window.setTimeout(() => {
    positionTimer = 0;
    const line = currentLine();
    if (currentUri && typeof line === 'number') {
      post({ type: 'position', uri: currentUri, line });
    }
  }, 120);
}

window.addEventListener('scroll', reportPosition, { passive: true });
document.addEventListener('selectionchange', reportPosition);

function offsetTopOf(element: Element): number {
  return Math.max(0, element.getBoundingClientRect().top + window.scrollY - config.scrollOffset);
}

/**
 * Put an element in the middle of the window rather than at the top.
 *
 * This is for the passage the cursor was on when the reader switched over from the
 * editor: what they want to see is the paragraph *and its surroundings*, the way the
 * editor shows it. A block taller than the window falls back to the top, since there is
 * no middle to put it in.
 */
function centerOf(element: Element): number {
  const rect = element.getBoundingClientRect();
  const top = rect.top + window.scrollY;
  const slack = Math.max(config.scrollOffset, (window.innerHeight - rect.height) / 2);
  return Math.max(0, top - slack);
}

/**
 * Images and diagrams change the page height after the HTML is in place, which would
 * leave a one-shot scroll pointing at the wrong content. Re-apply the target until the
 * layout stops moving, and give up the moment the reader scrolls themselves.
 */
function settleScroll(
  token: number,
  message: { uri: string; mode: NavMode },
  computeTarget: () => { top: number; anchored: boolean }
): void {
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
  };
  const events: (keyof WindowEventMap)[] = ['wheel', 'touchstart', 'keydown', 'mousedown'];
  for (const name of events) {
    window.addEventListener(name, cancel, { passive: true, once: true });
  }

  let anchored = false;
  const apply = () => {
    if (cancelled || token !== renderToken) {
      return;
    }
    const target = computeTarget();
    anchored = target.anchored;
    window.scrollTo(0, target.top);
  };

  const report = (final: boolean) => {
    if (token === renderToken) {
      post({
        type: 'settled',
        uri: message.uri,
        mode: message.mode,
        scrollTop: Math.round(window.scrollY),
        anchored,
        final,
      });
    }
  };

  apply();
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      apply();
      report(false);
    })
  );

  // Images, diagrams and the late KaTeX stylesheet all change the page height after the
  // HTML is in place. Watching for that beats re-scrolling on a timer, which kept the
  // page busy for a second and a half after every navigation.
  const observer = new ResizeObserver(() => apply());
  observer.observe(content);
  window.setTimeout(() => {
    observer.disconnect();
    for (const name of events) {
      window.removeEventListener(name, cancel);
    }
    report(true);
    reportPosition();
    cancelled = true;
  }, 1200);
}

/** Heading ids are slugified, so try the obvious spellings of the fragment in turn. */
function findAnchor(fragment: string): Element | null {
  const candidates = new Set<string>([fragment]);
  try {
    candidates.add(decodeURIComponent(fragment));
  } catch {
    /* fragment was not percent-encoded */
  }
  candidates.add(encodeURIComponent(fragment));
  candidates.add(fragment.toLowerCase());

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const byId = content.querySelector(`#${CSS.escape(candidate)}`);
    if (byId) {
      return byId;
    }
    const byName = content.querySelector(`[name="${CSS.escape(candidate)}"]`);
    if (byName) {
      return byName;
    }
  }

  const wanted = fragment.replace(/[-_]/g, ' ').trim().toLowerCase();
  for (const heading of Array.from(content.querySelectorAll('h1,h2,h3,h4,h5,h6'))) {
    if ((heading.textContent ?? '').trim().toLowerCase() === wanted) {
      return heading;
    }
  }
  return null;
}

// ------------------------------------------------------------------ mermaid

let mermaidModule: Promise<any> | undefined;

function loadMermaid(): Promise<any> {
  if (!mermaidModule) {
    mermaidModule = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.nonce = bootstrap.nonce;
      script.src = bootstrap.mermaidUri;
      script.onload = () => {
        const bundle = (window as any).MdxMermaid;
        resolve(bundle?.default ?? bundle);
      };
      script.onerror = () => reject(new Error('Failed to load the Mermaid bundle'));
      document.head.appendChild(script);
    });
  }
  return mermaidModule;
}

function isDarkTheme(): boolean {
  return (
    document.body.classList.contains('vscode-dark') ||
    document.body.classList.contains('vscode-high-contrast')
  );
}

/** Put the diagram source back so a processed block can be drawn again. */
function restoreMermaidSources(): void {
  for (const block of Array.from(content.querySelectorAll<HTMLElement>('pre.mdx-mermaid'))) {
    const source = block.dataset.mmdSrc;
    if (source !== undefined) {
      block.textContent = source;
      block.removeAttribute('data-processed');
    }
  }
}

async function renderMermaid(token: number): Promise<void> {
  if (!config.mermaid) {
    return;
  }
  const blocks = Array.from(content.querySelectorAll<HTMLElement>('pre.mdx-mermaid'));
  if (blocks.length === 0) {
    return;
  }
  try {
    const mermaid = await loadMermaid();
    if (token !== renderToken) {
      return;
    }
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: isDarkTheme() ? 'dark' : 'default',
    });
    await mermaid.run({ nodes: blocks, suppressErrors: true });
  } catch (error) {
    for (const block of blocks) {
      block.classList.add('mdx-mermaid-failed');
      block.title = String(error);
    }
  }
}

// Diagrams bake the theme colours into their SVG, so they have to be drawn again when
// the user switches between a light and a dark colour theme.
let mermaidIsDark = isDarkTheme();
new MutationObserver(() => {
  if (isDarkTheme() === mermaidIsDark) {
    return;
  }
  mermaidIsDark = !mermaidIsDark;
  restoreMermaidSources();
  void renderMermaid(renderToken);
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });

// ------------------------------------------------------------- interactions

function followAnchor(anchor: HTMLAnchorElement, newTab: boolean): void {
  post({
    type: 'navigate',
    kind: anchor.dataset.mdxKind as any,
    target: anchor.dataset.mdxTarget,
    href: anchor.dataset.mdxHref,
    fragment: anchor.dataset.mdxFragment,
    linkId: Number(anchor.dataset.mdxLink ?? -1),
    newTab,
  });
}

// Middle-click, like ctrl-click, opens a background tab in a browser.
content.addEventListener('auxclick', (event) => {
  if (event.button !== 1) {
    return;
  }
  const anchor = (event.target as HTMLElement | null)?.closest('a');
  if (anchor?.dataset.mdxKind) {
    event.preventDefault();
    followAnchor(anchor as HTMLAnchorElement, true);
  }
});

content.addEventListener('click', (event) => {
  const anchor = (event.target as HTMLElement | null)?.closest('a');
  if (!anchor) {
    return;
  }

  const kind = anchor.dataset.mdxKind;
  if (!kind) {
    // Links the renderer did not classify (footnote refs) are plain in-page jumps.
    const href = anchor.getAttribute('href') ?? '';
    if (href.startsWith('#')) {
      event.preventDefault();
      const target = findAnchor(href.slice(1));
      if (target) {
        window.scrollTo(0, offsetTopOf(target));
        // A citation lands on one line of the card's source list; make it findable.
        if (anchor.dataset.mdxCite) {
          target.classList.add('mdx-flash');
          window.setTimeout(() => target.classList.remove('mdx-flash'), 1600);
        }
      }
    }
    return;
  }

  event.preventDefault();
  followAnchor(anchor as HTMLAnchorElement, event.ctrlKey || event.metaKey);
});

document.addEventListener('dblclick', (event) => {
  if (!config.doubleClickToEdit) {
    return;
  }
  const target = event.target as HTMLElement | null;
  // Links, and the card's fold-out summary — two quick clicks there open and close it —
  // are the things a double-click should not hijack.
  if (target?.closest('a, summary')) {
    return;
  }
  const block = target?.closest<HTMLElement>('[data-line]');
  const line = block ? Number(block.dataset.line) : undefined;
  post({ type: 'switchToEditor', line: Number.isFinite(line) ? line : undefined });
});

// ------------------------------------------------------------- link peek

/**
 * Hovering (or focusing) a link to a Markdown page shows what that page says about
 * itself — its title and description — so a reader can tell where a link goes before
 * following it. Summaries come from the host, which caches front matter per file.
 */
const peek = (() => {
  const DELAY_MS = 300;
  const tip = document.createElement('div');
  tip.className = 'mdx-peek';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.appendChild(tip);

  const answers = new Map<string, Extract<ToWebview, { type: 'peekResult' }>>();
  let anchor: HTMLAnchorElement | undefined;
  let timer = 0;

  function show(): void {
    if (!anchor) {
      return;
    }
    const target = anchor.dataset.mdxTarget ?? '';
    const answer = answers.get(target);
    if (!answer) {
      return;
    }
    tip.replaceChildren();
    const add = (cls: string, text: string | undefined) => {
      if (text) {
        const el = document.createElement('div');
        el.className = cls;
        el.textContent = text;
        tip.appendChild(el);
      }
    };
    if (answer.found) {
      add('mdx-peek-meta', [answer.docType, answer.status && answer.status !== 'stable' ? answer.status : undefined]
        .filter(Boolean)
        .join(' · '));
      add('mdx-peek-title', answer.title ?? decodeURIComponent(target.split('/').pop() ?? target));
      add('mdx-peek-desc', answer.description);
    } else {
      add('mdx-peek-missing', 'This page does not exist.');
    }
    tip.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(420, window.innerWidth - 16);
    tip.style.maxWidth = `${width}px`;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - tip.offsetWidth - 8));
    const below = rect.bottom + 6;
    const top = below + tip.offsetHeight > window.innerHeight ? rect.top - tip.offsetHeight - 6 : below;
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(4, top)}px`;
  }

  function hide(): void {
    window.clearTimeout(timer);
    anchor = undefined;
    tip.hidden = true;
  }

  function begin(next: HTMLAnchorElement): void {
    if (next === anchor) {
      return;
    }
    hide();
    anchor = next;
    // The native tooltip would show the path on top of ours; keep it for when ours
    // has nothing to say.
    if (next.title && !next.dataset.mdxTitle) {
      next.dataset.mdxTitle = next.title;
      next.removeAttribute('title');
    }
    const target = next.dataset.mdxTarget ?? '';
    timer = window.setTimeout(() => {
      if (answers.has(target)) {
        show();
      } else {
        post({ type: 'peek', target });
      }
    }, DELAY_MS);
  }

  const markdownLink = (node: EventTarget | null) =>
    (node as HTMLElement | null)?.closest?.<HTMLAnchorElement>('a[data-mdx-kind="markdown"][data-mdx-target]') ?? undefined;

  content.addEventListener('mouseover', (event) => {
    const link = markdownLink(event.target);
    if (link) {
      begin(link);
    } else if (anchor && !anchor.contains(event.target as Node)) {
      hide();
    }
  });
  content.addEventListener('mouseleave', hide);
  content.addEventListener('focusin', (event) => {
    const link = markdownLink(event.target);
    if (link) {
      begin(link);
    }
  });
  content.addEventListener('focusout', hide);
  window.addEventListener('scroll', hide, { passive: true });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hide();
    }
  });
  content.addEventListener('mousedown', hide);

  return {
    answer(message: Extract<ToWebview, { type: 'peekResult' }>): void {
      answers.set(message.target, message);
      if (anchor?.dataset.mdxTarget === message.target) {
        show();
      }
    },
    /** A new document: forget summaries, which may have changed on disk. */
    reset(): void {
      hide();
      answers.clear();
    },
  };
})();

// VS Code resolves the contributed alt+left / alt+right keybindings for events that
// originate inside a webview, but handling them here too means navigation still works if
// that ever changes. The host debounces so a doubled event cannot skip an entry.
window.addEventListener('keydown', (event) => {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return;
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    post({ type: 'back' });
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    post({ type: 'forward' });
  }
});

window.addEventListener('message', (event: MessageEvent<ToWebview>) => {
  const message = event.data;
  if (message.type === 'render') {
    void render(message);
  } else if (message.type === 'config') {
    config = message.config;
  } else if (message.type === 'peekResult') {
    peek.answer(message);
  } else if (message.type === 'revealLine') {
    const line = message.line;
    settleScroll(renderToken, { uri: currentUri, mode: currentMode }, () => {
      const block = blockForLine(line);
      return block ? { top: centerOf(block), anchored: true } : { top: 0, anchored: false };
    });
  }
});

// Surface page-level failures to the extension's output channel instead of letting them
// disappear into a webview devtools console nobody has open.
window.addEventListener('error', (event) => {
  post({
    type: 'pageError',
    message: event.message,
    stack: event.error instanceof Error ? event.error.stack : undefined,
  });
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = (event as PromiseRejectionEvent).reason;
  post({
    type: 'pageError',
    message: `Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`,
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

post({ type: 'ready' });
