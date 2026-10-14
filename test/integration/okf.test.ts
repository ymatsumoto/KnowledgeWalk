import { assert, getApi, test, waitFor } from './harness';
import { allTabs, closeEverything, describeTabs, openThroughResolver, sample } from './shared';

const BUNDLE = ['okf', 'research', 'wiki'];

/** Ids of the rendered links whose resolved target ends with `suffix`, in page order. */
export function linkIdsTo(html: string, suffix: string): number[] {
  const ids: number[] = [];
  for (const tag of html.match(/<a\b[^>]*>/g) ?? []) {
    const id = /\bdata-mdx-link="(\d+)"/.exec(tag)?.[1];
    const target = /\bdata-mdx-target="([^"]*)"/.exec(tag)?.[1];
    if (id !== undefined && target && decodeURIComponent(target).endsWith(suffix)) {
      ids.push(Number(id));
    }
  }
  return ids;
}

export async function openOkf(...parts: string[]): Promise<string> {
  await openThroughResolver(sample(...BUNDLE, ...parts));
  const suffix = `/${parts.join('/')}`;
  await waitFor(`the preview to show ${suffix}`, () => getApi().activePreview?.uri.endsWith(suffix));
  return waitFor('the page to be rendered', () => {
    const html = getApi().renderedHtml();
    return html && getApi().activePreview?.uri.endsWith(suffix) ? html : undefined;
  });
}

test('OKF: a /-prefixed link is read from the bundle root, not the workspace folder', async () => {
  await closeEverything();
  const html = await openOkf('problems', 'p1.md');
  // Both the relative and the root-relative link land on the same page in the bundle.
  const ids = linkIdsTo(html, '/okf/research/wiki/ideas/i1.md');
  assert.ok(ids.length >= 2, `expected two links to ideas/i1.md, got ${ids.length}`);

  assert.ok(getApi().clickRenderedLink(ids[ids.length - 1]));
  await waitFor('the preview to move to ideas/i1.md', () =>
    getApi().activePreview?.uri.endsWith('/okf/research/wiki/ideas/i1.md')
  );
  assert.equal(allTabs().length, 1, `navigation must not open a tab: ${describeTabs()}`);
});

test('OKF: a link on the metadata card navigates in the tab, and Back returns', async () => {
  await closeEverything();
  const html = await openOkf('ideas', 'i1.md');
  // addresses: [problems/p1] — a Concept ID, resolved against the bundle root.
  const ids = linkIdsTo(html, '/okf/research/wiki/problems/p1.md');
  assert.ok(ids.length >= 1, 'the card links to problems/p1.md');
  assert.match(html, /<section class="mdx-card/);

  assert.ok(getApi().clickRenderedLink(ids[0]));
  const snapshot = await waitFor('the preview to move to problems/p1.md', () => {
    const current = getApi().activePreview;
    return current?.uri.endsWith('/problems/p1.md') ? current : undefined;
  });
  assert.equal(snapshot.title, 'p1.md');
  assert.equal(allTabs().length, 1, `navigation must not open a tab: ${describeTabs()}`);

  await new Promise((resolve) => setTimeout(resolve, 200));
  getApi().goBack();
  const back = await waitFor('Back to ideas/i1.md', () => {
    const current = getApi().activePreview;
    return current?.uri.endsWith('/ideas/i1.md') ? current : undefined;
  });
  assert.equal(back.departureLinkId, ids[0], 'Back remembers the card link that was followed');
});

test('OKF: hovering a link asks for the linked page\'s title and description', async () => {
  const html = await openOkf('ideas', 'i1.md');
  const target = /data-mdx-target="([^"]*\/wiki\/problems\/p1\.md)"/.exec(html)?.[1];
  assert.ok(target, 'the page links to problems/p1.md');
  const answer = await getApi().peek(target.replace(/&amp;/g, '&'));
  assert.equal(answer?.found, true);
  assert.equal(answer?.title, '単一座位の天井');
  assert.match(answer?.description ?? '', /^どの 1 座位を足しても/);

  const missing = await getApi().peek(target.replace('p1.md', 'nope.md'));
  assert.equal(missing?.found, false);
});
