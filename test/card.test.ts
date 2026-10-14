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
const BUNDLE = path.join(SAMPLES, 'okf', 'handbook', 'wiki');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

__setWorkspaceFolders([SAMPLES]);
__setFiles(walk(SAMPLES).filter((p) => /\.(md|pdf|png)$/.test(p)));
__setStatPaths(['/srv/shared/capacity-2020.md']);

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
  const html = card(await render('incidents/db-outage.md'));
  const header = /<div class="mdx-card-header">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
  assert.match(header, /mdx-c-default" title="type">incident</);
  assert.match(header, />unverified</);
  assert.match(header, /🤖 my-agent\/1\.4 · 2026-08-07/);
  // From the sample wiki's .mdexplorer.yaml.
  assert.match(header, /mdx-c-red" title="priority"><span class="mdx-badge-key">priority<\/span>high</);
  assert.match(header, /title="phase"><span class="mdx-badge-key">phase<\/span>open</);
  // stable is the default status and not worth a badge.
  assert.doesNotMatch(header, />stable</);
});

test('the title is dropped when the body already opens with it', async () => {
  const html = card(await render('incidents/db-outage.md'));
  assert.doesNotMatch(html, /mdx-card-(sub)?title/);
  assert.match(html, /<p class="mdx-card-lead">Write traffic saturated the primary/);
});

test('a title that says more than the heading is kept as a subtitle', async () => {
  const html = card(await render('decisions/read-replicas.md'));
  assert.match(html, /<div class="mdx-card-subtitle">Add read replicas for reporting \(as of 2026-08-07\)<\/div>/);
});

test('sources are listed with links, ids and their own keys', async () => {
  const html = card(await render('incidents/db-outage.md'));
  const sources = /<div class="mdx-card-sources">([\s\S]*?)<\/ol><\/div>/.exec(html)?.[1] ?? '';
  assert.match(
    sources,
    /<li id="mdx-src-bench1"><span class="mdx-src-id">bench1<\/span><a [^>]*data-mdx-kind="markdown" data-mdx-target="file:\/\/[^"]*\/wiki\/decisions\/read-replicas-benchmark\.md"[^>]*>Replica benchmark notes<\/a><span class="mdx-src-extra">relation: arising-from<\/span><\/li>/
  );
  assert.match(sources, /data-mdx-kind="external" data-mdx-href="https:\/\/example\.com\/papers\/smith2024"/);
});

test('extension keys under details resolve Concept IDs to the linked page\'s title', async () => {
  const html = card(await render('incidents/db-outage.md'));
  const details = /<details class="mdx-card-details">([\s\S]*?)<\/details>/.exec(html)?.[1] ?? '';
  assert.match(
    details,
    /<dt>resolved_by<\/dt><dd><span class="mdx-fm-chip"><a [^>]*data-mdx-target="file:\/\/[^"]*\/wiki\/decisions\/read-replicas\.md"[^>]*>Add read replicas for reporting \(as of 2026-08-07\)<\/a>/
  );
  assert.match(details, /<dt>related_incidents<\/dt><dd><span class="mdx-fm-empty">/);
  assert.match(details, /<dt>created<\/dt><dd>2026-08-07<\/dd>/);
  assert.doesNotMatch(details, /<dt>root<\/dt>/);
  assert.doesNotMatch(details, /<dt>(type|priority|phase|description|title)<\/dt>/);
});

test('each base of a front matter path resolves, and ambiguity is refused', async () => {
  const html = card(await render('decisions/read-replicas.md'));
  assert.match(html, /<dt>resolves<\/dt><dd><span class="mdx-fm-chip"><a [^>]*\/wiki\/incidents\/db-outage\.md"[^>]*>Primary database outage</);
  assert.match(html, /<dt>resource<\/dt><dd><a [^>]*\/wiki\/decisions\/read-replicas-benchmark\.md"[^>]*>Replica benchmark notes</);
  assert.match(html, /<dt>diagram<\/dt><dd><a [^>]*data-mdx-kind="file" data-mdx-target="file:\/\/[^"]*\/handbook\/attachments\/diagram\.pdf"/);
  assert.match(html, /<dt>see_also<\/dt><dd><span class="mdx-ref-ambiguous" title="Ambiguous: [^"]*">notes\/dup\.md<\/span>/);
  // No extension, so not a confident reference: plain text, no marker.
  assert.match(html, /<dt>missing_ref<\/dt><dd>incidents\/does-not-exist<\/dd>/);
});

test('trust, draft status and newer sources are shown', async () => {
  const html = card(await render('decisions/read-replicas.md'));
  assert.match(html, /mdx-c-green" title="Verified by human:alice \(2026-08-08\)">human-reviewed</);
  assert.match(html, /mdx-c-yellow" title="status">draft</);
  assert.match(html, /mdx-card-banner mdx-c-blue"><strong>Sources changed since<\/strong> bench1 was modified/);
  assert.match(html, /🤖 my-agent\/2\.0 · 2026-08-07/, 'the date as written, not shifted to UTC');
  assert.match(card(await render('decisions/read-replicas-benchmark.md')), />machine-checked</);
});

test('deprecated and stale pages carry banners, and a filesystem path is flagged', async () => {
  const html = card(await render('sources/old-capacity-report.md'));
  assert.match(html, /<section class="mdx-card mdx-card-deprecated"/);
  assert.match(html, /<strong>Deprecated<\/strong>/);
  assert.match(html, /<strong>Possibly out of date<\/strong> Marked stale after 2026-01-01/);
  assert.match(html, /data-mdx-target="file:\/\/\/srv\/shared\/capacity-2020\.md"[^>]*class="mdx-ref-nonportable"/);
});

test('the bundle index, which holds only okf_version, shows no card', async () => {
  assert.equal(card(await render('index.md')), '');
});

test('Attested Computation parameters are drawn as a table', async () => {
  const html = card(await render('calc/error-budget.md'));
  assert.match(html, /<dt>parameters<\/dt><dd><div class="mdx-fm-table"><table><thead><tr><th>name<\/th><th>type<\/th><th>required<\/th>/);
  assert.match(html, /<dt>executor<\/dt><dd><dl class="mdx-fm-nested"><div><dt>resource<\/dt><dd><a [^>]*read-replicas-benchmark\.md/);
});

test('card links and body links share one sequence of ids', async () => {
  const html = await render('incidents/db-outage.md');
  const ids = [...html.matchAll(/data-mdx-link="(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(ids, ids.map((_, i) => i));
});

test('[^id] naming a source becomes a numbered citation linking to the source list', async () => {
  const html = await render('decisions/read-replicas.md');
  assert.match(html, /<sup class="mdx-cite"><a href="#mdx-src-lee2023" data-mdx-cite="lee2023" title="Replication topology — attachments\/diagram\.pdf">\[1\]<\/a><\/sup>/);
  assert.match(html, /<a href="#mdx-src-bench1" data-mdx-cite="bench1" [^>]*>\[2\]<\/a>/);
  // Neither a source nor a footnote defined in the body.
  assert.match(html, /<sup class="mdx-cite mdx-cite-missing" title="No source with id &quot;nosuch&quot; in front matter">\[nosuch\?\]<\/sup>/);
  // An ordinary footnote defined in the body is left to markdown-it-footnote.
  assert.match(html, /<sup class="footnote-ref"><a href="#fn1" id="fnref1">\[1\]<\/a><\/sup>/);
  assert.doesNotMatch(html, /\[\^/);
});

test('citations are numbered in order of first use', async () => {
  const html = await render('incidents/db-outage.md');
  assert.match(html, /data-mdx-cite="smith2024"[^>]*>\[1\]/);
  assert.match(html, /data-mdx-cite="bench1"[^>]*>\[2\]/);
});

test('a document without sources leaves [^x] alone', async () => {
  resetRenderer();
  const uri = Uri.file(path.join(BUNDLE, 'notes', 'x.md'));
  const html = renderMarkdown('Text[^x].\n', CONFIG, { docUri: uri, webview, wikiIndex: index });
  assert.match(html, /Text\[\^x\]\./);
});

test('a directory is neither a link nor reported missing', async () => {
  __setStatDirectories(['/srv/shared/designs']);
  try {
    resetRenderer();
    const file = path.join(BUNDLE, 'decisions', 'read-replicas-benchmark.md');
    const uri = Uri.file(file);
    const text = '---\ntype: source\nresource: /srv/shared/designs\n---\n\n# x\n';
    const prepared = await service.prepare(uri, text);
    const html = renderMarkdown(text, CONFIG, { docUri: uri, webview, wikiIndex: index, prepared });
    assert.match(html, /<span class="mdx-ref-directory" title="Directory: \/srv\/shared\/designs">\/srv\/shared\/designs<\/span>/);
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
    const uri = Uri.file(path.join(BUNDLE, 'decisions', 'x.md'));
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

test('a source cited twice keeps the number it was first given', async () => {
  resetRenderer();
  const uri = Uri.file(path.join(BUNDLE, 'decisions', 'y.md'));
  const text = '---\ntype: idea\nsources:\n  - { id: a, resource: https://e.org/a }\n  - { id: b, resource: https://e.org/b }\n---\n\nOne[^b] two[^a] three[^b].\n';
  const prepared = await service.prepare(uri, text);
  const html = renderMarkdown(text, CONFIG, { docUri: uri, webview, wikiIndex: index, prepared });
  const numbers = [...html.matchAll(/data-mdx-cite="(\w)"[^>]*>\[(\d)\]/g)].map((m) => `${m[1]}${m[2]}`);
  assert.deepEqual(numbers, ['b1', 'a2', 'b1']);
});
