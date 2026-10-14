import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Uri, __setFiles, __setStatDirectories, __setStatPaths, __setWorkspaceFolders } from 'vscode';
import { WikiLinkIndex } from '../src/wikiIndex';
import { OkfService } from '../src/okf/service';
import { renderMarkdown, resetRenderer } from '../src/renderer/markdown';
import type { MdxConfig } from '../src/config';

const SAMPLES = path.resolve(__dirname, '..', '..', 'samples');
const BUNDLE = path.join(SAMPLES, 'okf', 'research', 'wiki');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

__setWorkspaceFolders([SAMPLES]);
__setFiles(walk(SAMPLES).filter((p) => /\.(md|pdf|png)$/.test(p)));
__setStatPaths(['/root/work/planC/REPORT.md']);

const index = new WikiLinkIndex();
const service = new OkfService(index);
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
  frontMatter: 'auto',
  frontMatterDisplay: {},
  maxHistoryLength: 50,
  scrollOffset: 8,
  wikiLinks: true,
  wikiRootMarkers: ['.obsidian'],
  wikiLinkFallback: 'unique',
  reclaimTextEditors: true,
  retainHiddenPreviews: true,
};

async function render(rel: string): Promise<string> {
  resetRenderer();
  const file = path.join(BUNDLE, rel);
  const uri = Uri.file(file);
  const text = fs.readFileSync(file, 'utf8');
  const prepared = await service.prepare(uri, text);
  return renderMarkdown(text, CONFIG, {
    docUri: uri,
    webview,
    wikiIndex: index,
    wikiRoot: prepared.roots.wikiRoot,
    prepared,
  });
}

const card = (html: string) => /<section class="mdx-card[^"]*"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';

test('the header line carries type, trust, generation and the wiki\'s own badges', async () => {
  const html = card(await render('problems/p1.md'));
  const header = /<div class="mdx-card-header">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
  assert.match(header, /mdx-c-default" title="type">problem</);
  assert.match(header, />unverified</);
  assert.match(header, /🤖 claude-code\/unknown · 2026-08-07/);
  // From the sample wiki's .mdexplorer.yaml.
  assert.match(header, /mdx-c-red" title="severity"><span class="mdx-badge-key">severity<\/span>high</);
  assert.match(header, /title="stage"><span class="mdx-badge-key">stage<\/span>open</);
  // stable is the default status and not worth a badge.
  assert.doesNotMatch(header, />stable</);
});

test('the title is dropped when the body already opens with it', async () => {
  const html = card(await render('problems/p1.md'));
  assert.doesNotMatch(html, /mdx-card-(sub)?title/);
  assert.match(html, /<p class="mdx-card-lead">どの 1 座位を足しても/);
});

test('a title that says more than the heading is kept as a subtitle', async () => {
  const html = card(await render('ideas/i1.md'));
  assert.match(html, /<div class="mdx-card-subtitle">座位選択の新しい目的関数（2026-08-07 時点）<\/div>/);
});

test('sources are listed with links, ids and their own keys', async () => {
  const html = card(await render('problems/p1.md'));
  const sources = /<div class="mdx-card-sources">([\s\S]*?)<\/ol><\/div>/.exec(html)?.[1] ?? '';
  assert.match(
    sources,
    /<li id="mdx-src-progress1"><span class="mdx-src-id">progress1<\/span><a [^>]*data-mdx-kind="markdown" data-mdx-target="file:\/\/[^"]*\/wiki\/ideas\/i1-progress\.md"[^>]*>進捗メモ<\/a><span class="mdx-src-extra">relation: arising-from<\/span><\/li>/
  );
  assert.match(sources, /data-mdx-kind="external" data-mdx-href="https:\/\/doi\.org\/10\.1128\/jcm\.00082-26"/);
});

test('extension keys under details resolve Concept IDs to the linked page\'s title', async () => {
  const html = card(await render('problems/p1.md'));
  const details = /<details class="mdx-card-details">([\s\S]*?)<\/details>/.exec(html)?.[1] ?? '';
  assert.match(
    details,
    /<dt>addressed_by<\/dt><dd><span class="mdx-fm-chip"><a [^>]*data-mdx-target="file:\/\/[^"]*\/wiki\/ideas\/i1\.md"[^>]*>座位選択の新しい目的関数（2026-08-07 時点）<\/a>/
  );
  assert.match(details, /<dt>related_problems<\/dt><dd><span class="mdx-fm-empty">/);
  assert.match(details, /<dt>created<\/dt><dd>2026-08-07<\/dd>/);
  assert.doesNotMatch(details, /<dt>root<\/dt>/);
  assert.doesNotMatch(details, /<dt>(type|severity|stage|description|title)<\/dt>/);
});

test('each base of a front matter path resolves, and ambiguity is refused', async () => {
  const html = card(await render('ideas/i1.md'));
  assert.match(html, /<dt>addresses<\/dt><dd><span class="mdx-fm-chip"><a [^>]*\/wiki\/problems\/p1\.md"[^>]*>単一座位の天井</);
  assert.match(html, /<dt>resource<\/dt><dd><a [^>]*\/wiki\/ideas\/i1-progress\.md"[^>]*>進捗メモ</);
  assert.match(html, /<dt>paper<\/dt><dd><a [^>]*data-mdx-kind="file" data-mdx-target="file:\/\/[^"]*\/research\/raw\/papers\/paper\.pdf"/);
  assert.match(html, /<dt>see_also<\/dt><dd><span class="mdx-ref-ambiguous" title="Ambiguous: [^"]*">notes\/dup\.md<\/span>/);
  // No extension, so not a confident reference: plain text, no marker.
  assert.match(html, /<dt>missing_ref<\/dt><dd>problems\/does-not-exist<\/dd>/);
});

test('trust, draft status and newer sources are shown', async () => {
  const html = card(await render('ideas/i1.md'));
  assert.match(html, /mdx-c-green" title="Verified by human:ymatsumoto \(2026-08-08\)">human-reviewed</);
  assert.match(html, /mdx-c-yellow" title="status">draft</);
  assert.match(html, /mdx-card-banner mdx-c-blue"><strong>Sources changed since<\/strong> progress1 was modified/);
  assert.match(html, /🤖 claude-code\/claude-opus-5 · 2026-08-07/, 'the date as written, not shifted to UTC');
  assert.match(card(await render('ideas/i1-progress.md')), />machine-checked</);
});

test('deprecated and stale pages carry banners, and a filesystem path is flagged', async () => {
  const html = card(await render('sources/s1.md'));
  assert.match(html, /<section class="mdx-card mdx-card-deprecated"/);
  assert.match(html, /<strong>Deprecated<\/strong>/);
  assert.match(html, /<strong>Possibly out of date<\/strong> Marked stale after 2026-01-01/);
  assert.match(html, /data-mdx-target="file:\/\/\/root\/work\/planC\/REPORT\.md"[^>]*class="mdx-ref-nonportable"/);
});

test('the bundle index, which holds only okf_version, shows no card', async () => {
  assert.equal(card(await render('index.md')), '');
});

test('Attested Computation parameters are drawn as a table', async () => {
  const html = card(await render('calc/c1.md'));
  assert.match(html, /<dt>parameters<\/dt><dd><div class="mdx-fm-table"><table><thead><tr><th>name<\/th><th>type<\/th><th>required<\/th>/);
  assert.match(html, /<dt>executor<\/dt><dd><dl class="mdx-fm-nested"><div><dt>resource<\/dt><dd><a [^>]*i1-progress\.md/);
});

test('card links and body links share one sequence of ids', async () => {
  const html = await render('problems/p1.md');
  const ids = [...html.matchAll(/data-mdx-link="(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(ids, ids.map((_, i) => i));
});

test('[^id] naming a source becomes a numbered citation linking to the source list', async () => {
  const html = await render('ideas/i1.md');
  assert.match(html, /<sup class="mdx-cite"><a href="#mdx-src-krause2008" data-mdx-cite="krause2008" title="Near-optimal sensor placements — raw\/papers\/paper\.pdf">\[1\]<\/a><\/sup>/);
  assert.match(html, /<a href="#mdx-src-progress1" data-mdx-cite="progress1" [^>]*>\[2\]<\/a>/);
  // Neither a source nor a footnote defined in the body.
  assert.match(html, /<sup class="mdx-cite mdx-cite-missing" title="No source with id &quot;nosuch&quot; in front matter">\[nosuch\?\]<\/sup>/);
  // An ordinary footnote defined in the body is left to markdown-it-footnote.
  assert.match(html, /<sup class="footnote-ref"><a href="#fn1" id="fnref1">\[1\]<\/a><\/sup>/);
  assert.doesNotMatch(html, /\[\^/);
});

test('citations are numbered in order of first use', async () => {
  const html = await render('problems/p1.md');
  assert.match(html, /data-mdx-cite="lee2025"[^>]*>\[1\]/);
  assert.match(html, /data-mdx-cite="progress1"[^>]*>\[2\]/);
});

test('a document without sources leaves [^x] alone', async () => {
  resetRenderer();
  const uri = Uri.file(path.join(BUNDLE, 'notes', 'x.md'));
  const html = renderMarkdown('Text[^x].\n', CONFIG, { docUri: uri, webview, wikiIndex: index });
  assert.match(html, /Text\[\^x\]\./);
});

test('a directory is neither a link nor reported missing', async () => {
  __setStatDirectories(['/root/work/design']);
  try {
    resetRenderer();
    const file = path.join(BUNDLE, 'ideas', 'i1-progress.md');
    const uri = Uri.file(file);
    const text = '---\ntype: source\nresource: /root/work/design\n---\n\n# x\n';
    const prepared = await service.prepare(uri, text);
    const html = renderMarkdown(text, CONFIG, { docUri: uri, webview, wikiIndex: index, prepared });
    assert.match(html, /<span class="mdx-ref-directory" title="Directory: \/root\/work\/design">\/root\/work\/design<\/span>/);
  } finally {
    __setStatDirectories([]);
  }
});

test('problems with a document are logged once each', async () => {
  const { log } = await import('../src/log');
  const seen: string[] = [];
  const original = log.warn;
  (log as any).warn = (message: string) => seen.push(message);
  try {
    resetRenderer();
    const uri = Uri.file(path.join(BUNDLE, 'ideas', 'x.md'));
    const text = '---\ntype: idea\nstale_after: next spring\nsources:\n  - { id: a, resource: https://e.org }\n---\n\nOne[^zz] two[^zz] three[^a].\n';
    const prepared = await service.prepare(uri, text);
    const html = renderMarkdown(text, CONFIG, { docUri: uri, webview, wikiIndex: index, prepared });
    assert.match(html, /\[zz\?\]/);
    assert.equal(seen.filter((m) => m.includes('[^zz]')).length, 1, seen.join('\n'));
    assert.equal(seen.filter((m) => m.includes('next spring')).length, 1, seen.join('\n'));
  } finally {
    (log as any).warn = original;
  }
});
