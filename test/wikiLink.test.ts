import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Uri, __setFiles, __setWorkspaceFolders } from 'vscode';
import { WikiLinkIndex } from '../src/wikiIndex';
import { renderMarkdown, resetRenderer } from '../src/renderer/markdown';
import type { MdxConfig } from '../src/config';

const VAULT = [
  '/ws/wiki/Home.md',
  '/ws/wiki/Sequencing pipeline.md',
  '/ws/wiki/notes/Alignment.md',
  '/ws/wiki/notes/Home.md',
  '/ws/wiki/assets/plot.png',
  '/ws/other/Alignment.md',
];

/**
 * Two same-named wikis side by side, plus a second project that grew links into the
 * first one later. `On-call guide` exists once in the whole workspace; `Index` exists
 * in both wikis.
 */
const TWO_WIKIS = [
  '/ws/a/handbook/Home.md',
  '/ws/a/handbook/Index.md',
  '/ws/a/handbook/On-call guide.md',
  '/ws/b/handbook/Home.md',
  '/ws/b/handbook/Index.md',
  '/ws/project-x/plan.md',
];

async function buildTwoWikis(): Promise<WikiLinkIndex> {
  __setWorkspaceFolders(['/ws']);
  __setFiles(TWO_WIKIS);
  const index = new WikiLinkIndex();
  await index.ensure();
  return index;
}

const webview = {
  asWebviewUri: (uri: any) => Uri.parse(`https://webview.test${uri.path}`),
  cspSource: 'https://webview.test',
} as any;

const CONFIG: MdxConfig = {
  doubleClickToEdit: true,
  mermaid: false,
  math: false,
  allowRawHtml: true,
  linkify: 'urls',
  frontMatter: 'hide',
  frontMatterDisplay: {},
  wikiLinks: true,
  wikiRootMarkers: ['.obsidian'],
  wikiLinkFallback: 'unique',
  maxHistoryLength: 50,
  scrollOffset: 8,
  reclaimTextEditors: true,
  retainHiddenPreviews: true,
};

async function build(): Promise<WikiLinkIndex> {
  __setWorkspaceFolders(['/ws']);
  __setFiles(VAULT);
  const index = new WikiLinkIndex();
  await index.ensure();
  return index;
}

async function render(
  source: string,
  from = '/ws/wiki/Home.md',
  overrides: Partial<MdxConfig> = {},
  root?: string
): Promise<string> {
  const index = await build();
  resetRenderer();
  return renderMarkdown(source, { ...CONFIG, ...overrides }, {
    docUri: Uri.file(from),
    webview,
    wikiIndex: index,
    wikiRoot: root ? Uri.file(root) : undefined,
  });
}

// ------------------------------------------------------------------- resolution

test('a bare name resolves to the file with that name anywhere in the vault', async () => {
  const html = await render('See [[Sequencing pipeline]] for the steps.\n');
  assert.match(html, /data-mdx-kind="markdown"/);
  assert.match(html, /data-mdx-target="file:\/\/\/ws\/wiki\/Sequencing%20pipeline\.md"/);
  assert.match(html, />Sequencing pipeline<\/a>/);
});

test('a name in a subdirectory resolves without being given a path', async () => {
  const html = await render('[[Alignment]]\n');
  assert.match(html, /data-mdx-target="file:\/\/\/ws\/wiki\/notes\/Alignment\.md"/);
});

test('a pipe supplies the link text', async () => {
  const html = await render('[[Sequencing pipeline|the pipeline]]\n');
  assert.match(html, />the pipeline<\/a>/);
  assert.match(html, /data-mdx-target="file:\/\/\/ws\/wiki\/Sequencing%20pipeline\.md"/);
});

test('a heading becomes the link fragment', async () => {
  const html = await render('[[Alignment#Parameters]]\n');
  assert.match(html, /data-mdx-fragment="Parameters"/);
  assert.match(html, />Alignment &gt; Parameters<\/a>/);
});

test('a block reference falls back to the file', async () => {
  const html = await render('[[Alignment#^abc123]]\n');
  assert.match(html, /data-mdx-target="file:\/\/\/ws\/wiki\/notes\/Alignment\.md"/);
});

test('a bare fragment stays on the current document', async () => {
  const html = await render('[[#Results]]\n');
  assert.match(html, /data-mdx-kind="anchor"/);
  assert.match(html, /data-mdx-fragment="Results"/);
  assert.match(html, />Results<\/a>/);
});

test('a path is read from the vault root', async () => {
  const html = await render('[[notes/Alignment]]\n', '/ws/wiki/Home.md', {}, '/ws/wiki');
  assert.match(html, /data-mdx-target="file:\/\/\/ws\/wiki\/notes\/Alignment\.md"/);
});

test('an explicit extension is respected', async () => {
  const html = await render('[[Home.md]]\n');
  assert.match(html, /data-mdx-target="file:\/\/\/ws\/wiki\/Home\.md"/);
});

test('a name with no file behind it is marked, not linked', async () => {
  const html = await render('[[No such note]]\n');
  assert.match(html, /<span class="mdx-wikilink-missing"[^>]*>No such note<\/span>/);
  assert.doesNotMatch(html, /<a /);
});

test('an ambiguous name prefers the document own folder', async () => {
  const fromNotes = await render('[[Home]]\n', '/ws/wiki/notes/Alignment.md');
  assert.match(fromNotes, /data-mdx-target="file:\/\/\/ws\/wiki\/notes\/Home\.md"/);
  const fromWiki = await render('[[Home]]\n', '/ws/wiki/Home.md');
  assert.match(fromWiki, /data-mdx-target="file:\/\/\/ws\/wiki\/Home\.md"/);
});

test('a root confines resolution to that subtree', async () => {
  // /ws/other/Alignment.md is shallower, so without a root it could win from elsewhere.
  const scoped = await render('[[Alignment]]\n', '/ws/README.md', {}, '/ws/other');
  assert.match(scoped, /data-mdx-target="file:\/\/\/ws\/other\/Alignment\.md"/);
  const elsewhere = await render('[[Alignment]]\n', '/ws/README.md', {}, '/ws/wiki');
  assert.match(elsewhere, /data-mdx-target="file:\/\/\/ws\/wiki\/notes\/Alignment\.md"/);
});

test('a root that excludes every candidate leaves the link unresolved', async () => {
  const html = await render('[[Alignment]]\n', '/ws/README.md', {}, '/ws/empty');
  assert.match(html, /mdx-wikilink-missing/);
});

// ----------------------------------------------------------------------- embeds

test('an embedded image renders as an image', async () => {
  const html = await render('![[plot.png]]\n');
  assert.match(html, /<img src="https:\/\/webview\.test\/ws\/wiki\/assets\/plot\.png"/);
  assert.match(html, /alt="plot\.png"/);
});

test('an embedded document falls back to a link', async () => {
  const html = await render('![[Alignment]]\n');
  assert.match(html, /data-mdx-target="file:\/\/\/ws\/wiki\/notes\/Alignment\.md"/);
});

// ------------------------------------------------------------------- edge cases

test('wiki links take part in the link numbering Back relies on', async () => {
  const html = await render('[[Home]] and [normal](Home.md) and [[Alignment]]\n');
  const ids = [...html.matchAll(/data-mdx-link="(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(ids, [0, 1, 2]);
});

test('brackets that are not wiki links are left alone', async () => {
  for (const source of ['[[unclosed\n', '[[a[b]]\n', '[single]\n', '[[]]\n']) {
    const html = await render(source);
    assert.doesNotMatch(html, /mdx-wikilink/, source);
  }
});

test('a wiki link inside a code span is not touched', async () => {
  const html = await render('Write `[[Home]]` to link.\n');
  assert.match(html, /<code>\[\[Home\]\]<\/code>/);
  assert.doesNotMatch(html, /mdx-wikilink/);
});

test('an escaped bracket is not a wiki link', async () => {
  const html = await render('\\[\\[Home]]\n');
  assert.doesNotMatch(html, /mdx-wikilink/);
});

test('the whole feature can be switched off', async () => {
  const html = await render('[[Home]]\n', '/ws/wiki/Home.md', { wikiLinks: false });
  assert.doesNotMatch(html, /mdx-wikilink/);
  assert.match(html, /\[\[Home\]\]/);
});

// -------------------------------------------------------------- the root value

/**
 * `rootFor` is what turns a `root:` front matter value into a directory. The forms are
 * deliberately not equivalent in usefulness: see the README.
 */
async function rootFor(from: string, declared?: unknown): Promise<string | undefined> {
  const index = await build();
  const root = await index.rootFor(Uri.file(from), declared);
  return root?.path;
}

test('a bare name means the nearest ancestor directory with that name', async () => {
  // The same literal value works at every depth, which is the point.
  assert.equal(await rootFor('/ws/wiki/Home.md', 'wiki'), '/ws/wiki');
  assert.equal(await rootFor('/ws/wiki/notes/Alignment.md', 'wiki'), '/ws/wiki');
  assert.equal(await rootFor('/ws/wiki/a/b/c/deep.md', 'wiki'), '/ws/wiki');
});

test('a relative path is resolved against the document, so it changes with depth', async () => {
  assert.equal(await rootFor('/ws/wiki/Home.md', '.'), '/ws/wiki');
  assert.equal(await rootFor('/ws/wiki/notes/Alignment.md', '..'), '/ws/wiki');
  // The same value one level deeper points somewhere else entirely.
  assert.equal(await rootFor('/ws/wiki/a/b/deep.md', '..'), '/ws/wiki/a');
});

test('an absolute path is used as given', async () => {
  assert.equal(await rootFor('/ws/wiki/Home.md', '/ws/other'), '/ws/other');
});

test('a name that is not an ancestor falls back instead of guessing', async () => {
  // No ancestor called "elsewhere"; the workspace folder answers instead.
  assert.equal(await rootFor('/ws/wiki/Home.md', 'elsewhere'), '/ws');
});

test('with no root declared, the workspace folder is used', async () => {
  assert.equal(await rootFor('/ws/wiki/notes/Alignment.md'), '/ws');
});

test('a document outside the workspace falls back to its own directory', async () => {
  assert.equal(await rootFor('/elsewhere/notes/x.md'), '/elsewhere/notes');
});

test('an ancestor-name root scopes resolution the same way a path does', async () => {
  const index = await build();
  const from = Uri.file('/ws/wiki/notes/Alignment.md');
  const root = await index.rootFor(from, 'wiki');
  const link = index.resolve('Home', from, { root });
  assert.equal(link?.uri.path, '/ws/wiki/notes/Home.md');
  assert.equal(link?.exists, true);
});

// ---------------------------------------------- several wikis in one workspace

test('two directories with the same name each resolve to their own', async () => {
  const index = await buildTwoWikis();
  for (const side of ['a', 'b']) {
    const from = Uri.file(`/ws/${side}/handbook/Index.md`);
    const root = await index.rootFor(from, 'handbook');
    assert.equal(root?.path, `/ws/${side}/handbook`, side);
    // A name that exists in both wikis stays inside the document's own.
    const link = index.resolve('Home', from, { root });
    assert.equal(link?.uri.path, `/ws/${side}/handbook/Home.md`, side);
  }
});

test('a name in both wikis is never resolved across them', async () => {
  const index = await buildTwoWikis();
  const from = Uri.file('/ws/a/handbook/Home.md');
  const root = await index.rootFor(from, 'handbook');
  // "Index" exists in /ws/a and /ws/b: the local one wins, with no fallback involved.
  const link = index.resolve('Index', from, { root });
  assert.equal(link?.uri.path, '/ws/a/handbook/Index.md');
  assert.equal(link?.crossWiki, undefined);
});

// -------------------------------------------------------- links across projects

test('a name outside the wiki resolves when exactly one file has it', async () => {
  const index = await buildTwoWikis();
  const from = Uri.file('/ws/project-x/plan.md');
  const root = await index.rootFor(from, 'project-x');
  assert.equal(root?.path, '/ws/project-x');

  const link = index.resolve('On-call guide', from, { root });
  assert.equal(link?.uri.path, '/ws/a/handbook/On-call guide.md');
  assert.equal(link?.exists, true);
  assert.equal(link?.crossWiki, true, 'and it is marked as leaving the wiki');
});

test('an ambiguous name outside the wiki stays unresolved rather than guessing', async () => {
  const index = await buildTwoWikis();
  const from = Uri.file('/ws/project-x/plan.md');
  const root = await index.rootFor(from, 'project-x');
  // "Home" exists in both wikis, so there is no defensible answer.
  const link = index.resolve('Home', from, { root });
  assert.equal(link?.exists, false);
});

test('the fallback can be switched off', async () => {
  const index = await buildTwoWikis();
  const from = Uri.file('/ws/project-x/plan.md');
  const root = await index.rootFor(from, 'project-x');
  const link = index.resolve('On-call guide', from, { root, fallback: 'none' });
  assert.equal(link?.exists, false);
});

test('links back into the second project work the same way', async () => {
  const index = await buildTwoWikis();
  const from = Uri.file('/ws/a/handbook/Home.md');
  const root = await index.rootFor(from, 'handbook');
  const link = index.resolve('plan', from, { root });
  assert.equal(link?.uri.path, '/ws/project-x/plan.md');
  assert.equal(link?.crossWiki, true);
});

test('a cross-wiki link is marked in the rendered HTML', async () => {
  const index = await buildTwoWikis();
  resetRenderer();
  const from = Uri.file('/ws/project-x/plan.md');
  const root = await index.rootFor(from, 'project-x');
  const html = renderMarkdown('[[On-call guide]]\n', CONFIG, {
    docUri: from,
    webview,
    wikiIndex: index,
    wikiRoot: root,
  });
  assert.match(html, /class="mdx-wikilink mdx-wikilink-external"/);
});
