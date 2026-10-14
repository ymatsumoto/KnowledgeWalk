import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Uri, __setFiles, __setWorkspaceFolders } from 'vscode';
import { WikiLinkIndex } from '../src/wikiIndex';
import { renderMarkdown, resetRenderer } from '../src/renderer/markdown';
import type { MdxConfig } from '../src/config';

const SAMPLES = path.join(__dirname, '..', '..', 'samples');

/** Minimal stand-in for the bits of `Webview` the renderer touches. */
const webview = {
  asWebviewUri: (uri: any) => Uri.parse(`https://webview.test${uri.path}`),
  cspSource: 'https://webview.test',
} as any;

const CONFIG: MdxConfig = {
  doubleClickToEdit: true,
  mermaid: true,
  math: true,
  allowRawHtml: true,
  linkify: 'urls',
  frontMatter: 'hide',
  frontMatterDisplay: {},
  maxHistoryLength: 50,
  scrollOffset: 8,
  wikiLinks: true,
  wikiRootMarkers: ['.obsidian'],
  wikiLinkFallback: 'unique',
  reclaimTextEditors: true,
  retainHiddenPreviews: true,
};

const index = new WikiLinkIndex();

function render(file: string, overrides: Partial<MdxConfig> = {}): string {
  resetRenderer();
  const uri = Uri.parse(`file://${path.join(SAMPLES, file)}`);
  return renderMarkdown(fs.readFileSync(path.join(SAMPLES, file), 'utf8'), {
    ...CONFIG,
    ...overrides,
  }, { docUri: uri, webview, wikiIndex: index });
}

test('every link is classified and carries a resolved target', () => {
  const html = render('index.md');

  assert.match(html, /data-mdx-kind="markdown"[^>]*data-mdx-target="file:\/\/[^"]*\/samples\/guide\.md"/);
  assert.match(html, /data-mdx-target="file:\/\/[^"]*\/samples\/sub\/deep\.md"/);
  assert.match(html, /data-mdx-kind="file"[^>]*data-mdx-target="file:\/\/[^"]*\/samples\/data\/table\.csv"/);
  assert.match(html, /data-mdx-kind="external"[^>]*data-mdx-href="https:\/\/code\.visualstudio\.com\/api"/);
  assert.match(html, /data-mdx-kind="anchor"/);
});

test('a fragment on a markdown link survives into the attributes', () => {
  const html = render('index.md');
  assert.match(html, /data-mdx-target="file:\/\/[^"]*guide\.md"[^>]*data-mdx-fragment="settings"/);
});

test('link ids are assigned in document order so Back can find them again', () => {
  const html = render('index.md');
  const ids = [...html.matchAll(/data-mdx-link="(\d+)"/g)].map((m) => Number(m[1]));
  assert.ok(ids.length > 5, `expected several links, got ${ids.length}`);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
  assert.equal(new Set(ids).size, ids.length, 'link ids must be unique');
  assert.equal(ids[0], 0);
});

test('relative image sources are rewritten to webview URIs', () => {
  const html = render('index.md');
  assert.match(html, /<img src="https:\/\/webview\.test[^"]*\/samples\/assets\/logo\.png"/);

  const deep = render('sub/deep.md');
  assert.match(deep, /src="https:\/\/webview\.test[^"]*\/samples\/sub\/inline\.png"/);
  assert.match(deep, /src="https:\/\/webview\.test[^"]*\/samples\/assets\/logo\.png"/);
});

test('block elements carry the source line double-click maps back to', () => {
  const html = render('index.md');
  const lines = [...html.matchAll(/data-line="(\d+)"/g)].map((m) => Number(m[1]));
  assert.ok(lines.length > 5, `expected data-line on several blocks, got ${lines.length}`);
  assert.equal(lines[0], 0, 'the first heading starts on line 0');
});

test('headings get ids so #fragment links have something to land on', () => {
  const html = render('guide.md');
  assert.match(html, /<h2[^>]*id="[^"]+"/);
});

test('mermaid blocks are left for the webview to draw, and disabled on request', () => {
  const enabled = render('index.md');
  assert.match(enabled, /<pre class="mdx-mermaid"[^>]*data-mmd-src="/);
  assert.match(enabled, /flowchart LR/);

  const disabled = render('index.md', { mermaid: false });
  assert.doesNotMatch(disabled, /mdx-mermaid/);
  assert.match(disabled, /<pre class="mdx-code"/);
});

test('math is rendered by KaTeX, and skipped when turned off', () => {
  const enabled = render('index.md');
  assert.match(enabled, /class="katex/);

  const disabled = render('index.md', { math: false });
  assert.doesNotMatch(disabled, /class="katex/);
});

test('fenced code is syntax highlighted', () => {
  const html = render('index.md');
  assert.match(html, /<pre class="mdx-code" data-line="\d+"><code class="hljs language-ts">/);
  assert.match(html, /class="hljs-keyword"/);
});

test('GitHub flavoured constructs render', () => {
  const html = render('index.md');
  assert.match(html, /<table[ >]/);
  assert.match(html, /class="task-list-item-checkbox"/);
  assert.doesNotMatch(html, /checked=""type=/, 'attributes must be separated by a space');
});

test('footnotes render with back-references', () => {
  const html = render('guide.md');
  assert.match(html, /class="footnotes"/);
  assert.match(html, /footnote-ref/);
});

test('code fences are escaped rather than executed', () => {
  resetRenderer();
  const uri = Uri.parse('file:///ws/x.md');
  const html = renderMarkdown('```\n<script>alert(1)</script>\n```\n', CONFIG, {
    docUri: uri,
    webview,
    wikiIndex: index,
  });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

const FRONT_MATTER = `---
title: A wiki page
tags:
  - alpha
  - beta
source: https://example.com/page
empty:
---

# Heading

Body text.
`;

function renderText(source: string, overrides: Partial<MdxConfig> = {}): string {
  resetRenderer();
  return renderMarkdown(source, { ...CONFIG, ...overrides }, {
    docUri: Uri.parse('file:///ws/x.md'),
    webview,
    wikiIndex: index,
  });
}

test('YAML front matter is dropped by default rather than rendered as bold text', () => {
  const html = renderText(FRONT_MATTER, { frontMatter: 'hide' });
  assert.doesNotMatch(html, /A wiki page/);
  assert.doesNotMatch(html, /<hr>/, 'the --- fences must not become rules');
  assert.match(html, /<h1[^>]*>Heading<\/h1>/);
});

test('front matter can be shown as a metadata card', () => {
  const html = renderText(FRONT_MATTER, { frontMatter: 'table' });
  assert.match(html, /<section class="mdx-card"/);
  // The title differs from the body's H1, so it is kept, as a subtitle.
  assert.match(html, /<div class="mdx-card-subtitle">A wiki page<\/div>/);
  assert.match(html, /<span class="mdx-fm-chip">alpha<\/span>/);
  assert.match(html, /<dt>source<\/dt><dd><a [^>]*data-mdx-kind="external"[^>]*https:\/\/example\.com\/page/);
  assert.match(html, /<dt>empty<\/dt><dd><span class="mdx-fm-empty">/, 'an empty value is shown as a dash');
});

test('auto shows a card only for front matter with a type', () => {
  assert.doesNotMatch(renderText(FRONT_MATTER, { frontMatter: 'auto' }), /mdx-card/);
  const typed = renderText(`---\ntype: note\n---\n\n# H\n`, { frontMatter: 'auto' });
  assert.match(typed, /<section class="mdx-card"/);
  assert.match(typed, /<span class="mdx-badge mdx-c-default" title="type">note<\/span>/);
});

test('values in the card are escaped', () => {
  const html = renderText(`---\ntype: "<img src=x onerror=alert(1)>"\nnote: "<b>bold</b>"\n---\n`, {
    frontMatter: 'table',
  });
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<b>bold/);
  assert.match(html, /&lt;b&gt;bold&lt;\/b&gt;/);
});

test('front matter can be shown as raw YAML', () => {
  const html = renderText(FRONT_MATTER, { frontMatter: 'source' });
  assert.match(html, /class="mdx-frontmatter-source"/);
  assert.match(html, /title: A wiki page/);
});

test('front matter does not shift the source lines double-click maps to', () => {
  for (const mode of ['hide', 'table', 'source', 'auto'] as const) {
    const html = renderText(FRONT_MATTER, { frontMatter: mode });
    // `# Heading` is line 9 (0-based): eight front matter lines plus the blank line.
    assert.match(html, /<h1[^>]*data-line="9"/, mode);
  }
});

test('malformed front matter falls back to showing the raw text', () => {
  const html = renderText('---\n\tbad: [unclosed\n---\n\n# H\n', { frontMatter: 'table' });
  assert.match(html, /class="mdx-frontmatter-source"/);
});

test('a filename mentioned in prose is not turned into a link', () => {
  const source = 'Run build.py first, then check setup.cfg and README.md.\n';
  const html = renderText(source, { linkify: 'urls' });
  assert.doesNotMatch(html, /<a /, `nothing here is a URL: ${html}`);
});

test('text that says it is a URL is still linked', () => {
  const html = renderText('See https://example.com/a?b=1 for details.\n', { linkify: 'urls' });
  assert.match(html, /data-mdx-kind="external"[^>]*https:\/\/example\.com\/a\?b=1/);
});

test('bare hostnames are only linked when linkify is set to all', () => {
  assert.doesNotMatch(renderText('Visit www.example.com.\n', { linkify: 'urls' }), /<a /);
  assert.match(renderText('Visit www.example.com.\n', { linkify: 'all' }), /<a /);
  // The behaviour that made build.py a link in the first place.
  assert.match(renderText('Run build.py\n', { linkify: 'all' }), /<a /);
});

test('linkify can be switched off entirely', () => {
  assert.doesNotMatch(renderText('See https://example.com now.\n', { linkify: 'off' }), /<a /);
});

test('explicit markdown links are unaffected by the linkify setting', () => {
  for (const mode of ['off', 'urls', 'all'] as const) {
    const html = renderText('[script](build.py)\n', { linkify: mode });
    assert.match(html, /data-mdx-kind="file"/, mode);
  }
});

test('headings and fragments outside ASCII keep working', () => {
  // Deliberately non-ASCII: heading ids are slugified with Unicode letters kept.
  const html = renderText('## 設定 Überblick\n\n[jump](#設定-überblick)\n');
  assert.match(html, /<h2 id="%E8%A8%AD%E5%AE%9A-%C3%BCberblick"/);
  assert.match(html, /data-mdx-kind="anchor"[^>]*data-mdx-fragment="設定-überblick"/);
});
