import * as vscode from 'vscode';
import MarkdownIt from 'markdown-it';
import type { Options } from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import type Renderer from 'markdown-it/lib/renderer.mjs';
import anchor from 'markdown-it-anchor';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';
import katexPlugin from '@vscode/markdown-it-katex';
import frontMatterPlugin from 'markdown-it-front-matter';
import type { MdxConfig } from '../config';
import { classifyLink, resolveResource } from './linkRewrite';
import { escapeHtml, highlightCode } from './highlight';
import { renderFrontMatter, readFrontMatter } from './frontMatter';
import { wikiLinkPlugin } from './wikiLink';
import { okfCitePlugin } from './okfCite';
import { parseOkf, type SourceEntry } from '../okf/model';
import type { WikiLinkIndex } from '../wikiIndex';
import { log } from '../log';
import type { PreparedDocument } from '../okf/service';
import type { RootLinkContext } from './linkRewrite';

/**
 * How aggressively plain text is turned into links.
 *
 *  - `off`   nothing is autolinked
 *  - `urls`  only text carrying an explicit scheme, e.g. `https://example.com`
 *  - `all`   also bare domain-like text, which mistakes `vcf2phylip.py` for a host
 */
export type LinkifyMode = 'off' | 'urls' | 'all';

/** Everything the renderer needs to know about where a document lives. */
export interface RenderContext {
  docUri: vscode.Uri;
  webview: vscode.Webview;
  wikiIndex: WikiLinkIndex;
  /** Subtree that `[[wiki links]]` are resolved within; see WikiLinkIndex.rootFor. */
  wikiRoot?: vscode.Uri;
  /** Roots, front matter and file existence looked up before rendering; see OkfService. */
  prepared?: PreparedDocument;
}

interface RenderEnv extends RenderContext {
  /** Running counter that gives every anchor in the document a stable id. */
  linkCount: number;
  /** Base for `/`-prefixed links, derived from `prepared`. */
  rootLinks?: RootLinkContext;
  /** Log a problem with the document, once per render. */
  okfWarn(message: string): void;
  /** `sources[].id` -> entry, for `[^id]` citations; see okfCite. */
  okfSources?: Map<string, SourceEntry>;
}

/**
 * Tokens that open a block-level construct and therefore carry a useful source line.
 * `data-line` on these is what lets a double-click in the preview land on the right
 * line of the underlying file.
 */
function isBlockToken(token: Token): boolean {
  return !token.type.endsWith('_close') && !!token.map && token.map.length > 0;
}

let cached: { key: string; md: MarkdownIt } | undefined;

function configKey(cfg: MdxConfig): string {
  return [
    cfg.allowRawHtml,
    cfg.linkify,
    cfg.math,
    cfg.mermaid,
    cfg.frontMatter,
    cfg.wikiLinks,
    cfg.wikiLinkFallback,
  ].join('|');
}

function createMarkdownIt(cfg: MdxConfig): MarkdownIt {
  const md = new MarkdownIt({
    html: cfg.allowRawHtml,
    linkify: cfg.linkify !== 'off',
    breaks: false,
    typographer: false,
  });

  if (cfg.linkify === 'urls') {
    // linkify-it's "fuzzy" matching treats anything shaped like a hostname as a link,
    // so a filename mentioned in prose — `vcf2phylip.py`, `setup.cfg` — becomes a dead
    // link to a nonexistent host. Only autolink text that says it is a URL.
    md.linkify.set({ fuzzyLink: false, fuzzyEmail: false, fuzzyIP: false });
  }

  md.use(anchor, {
    level: [1, 2, 3, 4, 5, 6],
    slugify: (s: string) =>
      encodeURIComponent(s.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-À-￿]/g, '')),
  });
  md.use(footnote);
  md.use(okfCitePlugin);
  // Consumes the `---` block at the top of the file, which would otherwise parse as a
  // setext heading. The callback is unused; the token carries the text.
  md.use(frontMatterPlugin, () => undefined);
  md.use(taskLists, { enabled: true, label: true });
  if (cfg.wikiLinks) {
    md.use(wikiLinkPlugin, { fallback: cfg.wikiLinkFallback });
  }

  // Record source lines so double-click can map preview -> editor.
  md.core.ruler.push('mdx_source_lines', (state) => {
    for (const token of state.tokens) {
      if (isBlockToken(token)) {
        token.attrSet('data-line', String(token.map![0]));
      }
    }
    return true;
  });

  const defaultRender = (tokens: Token[], idx: number, options: Options, _env: unknown, self: Renderer) =>
    self.renderToken(tokens, idx, options);

  md.renderer.rules.front_matter = (tokens, idx, _options, env) => {
    const renderEnv = env as RenderEnv;
    const heading = tokens.findIndex((token) => token.type === 'heading_open' && token.tag === 'h1');
    return renderFrontMatter(String(tokens[idx].meta ?? ''), cfg.frontMatter, {
      docUri: renderEnv.docUri,
      prepared: renderEnv.prepared,
      firstH1: heading >= 0 ? tokens[heading + 1]?.content : undefined,
      nextLinkId: () => renderEnv.linkCount++,
      warn: renderEnv.okfWarn,
      now: Date.now(),
    });
  };

  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const renderEnv = env as RenderEnv;
    const linkId = renderEnv.linkCount++;
    token.attrSet('data-mdx-link', String(linkId));

    const href = token.attrGet('href');
    if (href) {
      const link = classifyLink(href, renderEnv.docUri, renderEnv.rootLinks);
      token.attrSet('data-mdx-kind', link.kind);
      if (link.target) {
        token.attrSet('data-mdx-target', link.target.toString());
      }
      if (link.href) {
        token.attrSet('data-mdx-href', link.href);
      }
      if (link.fragment) {
        token.attrSet('data-mdx-fragment', link.fragment);
      }
      if (!token.attrGet('title')) {
        token.attrSet('title', link.href ?? link.target?.fsPath ?? href);
      }
    }
    return defaultRender(tokens, idx, options, env, self);
  };

  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const renderEnv = env as RenderEnv;
    const src = token.attrGet('src');
    if (src) {
      const resolved = resolveResource(src, renderEnv.docUri, renderEnv.rootLinks);
      if (resolved) {
        token.attrSet('src', renderEnv.webview.asWebviewUri(resolved).toString());
      }
    }
    // markdown-it stores the alt text as inline children rather than an attribute.
    token.attrSet('alt', self.renderInlineAsText(token.children ?? [], options, env));
    return defaultRender(tokens, idx, options, env, self);
  };

  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const info = (token.info || '').trim().split(/\s+/)[0].toLowerCase();
    const line = token.attrGet('data-line');
    const lineAttr = line ? ` data-line="${line}"` : '';

    if (cfg.mermaid && info === 'mermaid') {
      return `<pre class="mdx-mermaid"${lineAttr} data-mmd-src="${escapeHtml(token.content)}">${escapeHtml(
        token.content
      )}</pre>\n`;
    }

    const { html, language } = highlightCode(token.content, info);
    const languageClass = language ? ` language-${escapeHtml(language)}` : '';
    return `<pre class="mdx-code"${lineAttr}><code class="hljs${languageClass}">${html}</code></pre>\n`;
  };

  // KaTeX must be applied last: it wraps whatever `fence` renderer is in place.
  if (cfg.math) {
    md.use(katexPlugin, { enableBareBlocks: true, enableFencedBlocks: true });
  }

  return md;
}

function getMarkdownIt(cfg: MdxConfig): MarkdownIt {
  const key = configKey(cfg);
  if (!cached || cached.key !== key) {
    cached = { key, md: createMarkdownIt(cfg) };
  }
  return cached.md;
}

export function renderMarkdown(text: string, cfg: MdxConfig, context: RenderContext): string {
  const { prepared } = context;
  const warned = new Set<string>();
  const env: RenderEnv = {
    ...context,
    linkCount: 0,
    okfWarn: (message: string) => {
      if (!warned.has(message)) {
        warned.add(message);
        log.warn(`${context.docUri.path}: ${message}`);
      }
    },
    okfSources: sourcesById(prepared?.frontMatter),
    rootLinks: prepared
      ? { bundleRoot: prepared.roots.bundleRoot, exists: prepared.exists }
      : undefined,
  };
  const html = getMarkdownIt(cfg).render(text, env);
  // markdown-it-task-lists emits `checked=""type="checkbox"` without a separating
  // space. Parsers recover from it, but there is no reason to ship invalid markup.
  return html.replace(/checked=""type=/g, 'checked="" type=');
}

function sourcesById(frontMatter: Record<string, unknown> | undefined): Map<string, SourceEntry> | undefined {
  if (!frontMatter || !Array.isArray(frontMatter.sources)) {
    return undefined;
  }
  const byId = new Map<string, SourceEntry>();
  for (const source of parseOkf(frontMatter).sources) {
    if (source.id && !byId.has(source.id)) {
      byId.set(source.id, source);
    }
  }
  return byId;
}

/** Invalidate the cached markdown-it instance, e.g. after a settings change. */
export function resetRenderer(): void {
  cached = undefined;
}

// Re-exported so the panel can read a document's `root:` before rendering it, without
// pulling the YAML parser into the eagerly loaded part of the bundle.
export { readFrontMatter };
