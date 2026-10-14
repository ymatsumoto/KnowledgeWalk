import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Uri, __setWorkspaceFolders } from 'vscode';
import { classifyLink, resolveResource } from '../src/renderer/linkRewrite';

const BASE = Uri.parse('file:///ws/docs/index.md');

test('a bare fragment stays on the current document', () => {
  const link = classifyLink('#getting-started', BASE);
  assert.equal(link.kind, 'anchor');
  assert.equal(link.fragment, 'getting-started');
  assert.equal(link.target?.path, '/ws/docs/index.md');
});

test('a sibling markdown file resolves next to the document', () => {
  for (const href of ['guide.md', './guide.md']) {
    const link = classifyLink(href, BASE);
    assert.equal(link.kind, 'markdown', href);
    assert.equal(link.target?.path, '/ws/docs/guide.md', href);
  }
});

test('a markdown link keeps its fragment', () => {
  const link = classifyLink('guide.md#install', BASE);
  assert.equal(link.kind, 'markdown');
  assert.equal(link.target?.path, '/ws/docs/guide.md');
  assert.equal(link.fragment, 'install');
});

test('parent and child relative paths are normalised', () => {
  assert.equal(classifyLink('../README.md', BASE).target?.path, '/ws/README.md');
  assert.equal(classifyLink('sub/deep.md', BASE).target?.path, '/ws/docs/sub/deep.md');
  assert.equal(classifyLink('../docs/sub/../guide.md', BASE).target?.path, '/ws/docs/guide.md');
});

test('percent-encoded paths are decoded before resolving', () => {
  assert.equal(classifyLink('my%20notes.md', BASE).target?.path, '/ws/docs/my notes.md');
});

test('a root-relative path resolves against the workspace folder', () => {
  __setWorkspaceFolders(['/ws']);
  assert.equal(classifyLink('/docs/guide.md', BASE).target?.path, '/ws/docs/guide.md');
  __setWorkspaceFolders([]);
});

test('without a workspace, a root-relative path falls back to the document folder', () => {
  assert.equal(classifyLink('/guide.md', BASE).target?.path, '/ws/docs/guide.md');
});

test('non-markdown local files are handed to the normal editor', () => {
  assert.equal(classifyLink('data/table.csv', BASE).kind, 'file');
  assert.equal(classifyLink('diagram.png', BASE).kind, 'file');
  assert.equal(classifyLink('../scripts/run.sh', BASE).kind, 'file');
});

test('every markdown extension is recognised', () => {
  for (const href of ['a.md', 'a.markdown', 'a.MD', 'a.mkd']) {
    assert.equal(classifyLink(href, BASE).kind, 'markdown', href);
  }
});

test('remote and shell schemes are opened outside the preview', () => {
  for (const href of ['https://example.com/a.md', 'http://example.com', 'mailto:a@b.c']) {
    const link = classifyLink(href, BASE);
    assert.equal(link.kind, 'external', href);
    assert.equal(link.href, href, href);
  }
});

test('an absolute file: link is treated like any other document', () => {
  const link = classifyLink('file:///elsewhere/notes.md#top', BASE);
  assert.equal(link.kind, 'markdown');
  assert.equal(link.target?.path, '/elsewhere/notes.md');
  assert.equal(link.fragment, 'top');
});

test('an empty href is ignored', () => {
  assert.equal(classifyLink('   ', BASE).kind, 'unknown');
});

test('image sources resolve relative to the document, remote ones are left alone', () => {
  assert.equal(resolveResource('assets/logo.png', BASE)?.path, '/ws/docs/assets/logo.png');
  assert.equal(resolveResource('../img/x.svg', BASE)?.path, '/ws/img/x.svg');
  assert.equal(resolveResource('https://example.com/x.png', BASE), undefined);
  assert.equal(resolveResource('data:image/png;base64,AAAA', BASE), undefined);
});

test('query strings and fragments are stripped from image sources', () => {
  assert.equal(resolveResource('logo.png?v=2', BASE)?.path, '/ws/docs/logo.png');
});

test('in an OKF bundle a root-relative path is read from the bundle root first', () => {
  __setWorkspaceFolders(['/ws']);
  const base = Uri.parse('file:///ws/handbook/wiki/decisions/read-replicas.md');
  const roots = {
    bundleRoot: Uri.parse('file:///ws/handbook/wiki'),
    exists: (p: string) =>
      ['/ws/handbook/wiki/incidents/db-outage.md', '/ws/top.md', '/etc/notes.md'].includes(p),
  };
  assert.equal(classifyLink('/incidents/db-outage.md', base, roots).target?.path, '/ws/handbook/wiki/incidents/db-outage.md');
  // Not in the bundle: the workspace folder, as before bundles existed.
  assert.equal(classifyLink('/top.md', base, roots).target?.path, '/ws/top.md');
  // Neither: a real filesystem path.
  assert.equal(classifyLink('/etc/notes.md', base, roots).target?.path, '/etc/notes.md');
  // Nowhere at all: the bundle, which is where OKF says it should have been.
  assert.equal(classifyLink('/gone.md', base, roots).target?.path, '/ws/handbook/wiki/gone.md');
  __setWorkspaceFolders([]);
});
