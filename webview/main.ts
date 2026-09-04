import DOMPurify from 'dompurify';
import type { FromWebview, ToWebview, WebviewConfig, PreviewState } from '../src/protocol';

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
  config = message.config;
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
    (message.mode === 'push' && !!message.fragment);
  return { top: 0, anchored: !wasAskedForTarget };
}

function offsetTopOf(element: Element): number {
  return Math.max(0, element.getBoundingClientRect().top + window.scrollY - config.scrollOffset);
}

/**
 * Images and diagrams change the page height after the HTML is in place, which would
 * leave a one-shot scroll pointing at the wrong content. Re-apply the target until the
 * layout stops moving, and give up the moment the reader scrolls themselves.
 */
function settleScroll(
  token: number,
  message: Extract<ToWebview, { type: 'render' }>,
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
  // Links are the one thing a double-click should not hijack.
  if (target?.closest('a')) {
    return;
  }
  const block = target?.closest<HTMLElement>('[data-line]');
  const line = block ? Number(block.dataset.line) : undefined;
  post({ type: 'switchToEditor', line: Number.isFinite(line) ? line : undefined });
});

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
