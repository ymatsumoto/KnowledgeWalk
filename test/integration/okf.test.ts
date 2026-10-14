import * as vscode from 'vscode';
import { assert, getApi, test, waitFor } from './harness';
import { allTabs, closeEverything, describeTabs, openThroughResolver, sample } from './shared';

const BUNDLE = ['okf', 'handbook', 'wiki'];

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
  const html = await openOkf('incidents', 'db-outage.md');
  // Both the relative and the root-relative link land on the same page in the bundle.
  const ids = linkIdsTo(html, '/okf/handbook/wiki/decisions/read-replicas.md');
  assert.ok(ids.length >= 2, `expected two links to decisions/read-replicas.md, got ${ids.length}`);

  assert.ok(getApi().clickRenderedLink(ids[ids.length - 1]));
  await waitFor('the preview to move to decisions/read-replicas.md', () =>
    getApi().activePreview?.uri.endsWith('/okf/handbook/wiki/decisions/read-replicas.md')
  );
  assert.equal(allTabs().length, 1, `navigation must not open a tab: ${describeTabs()}`);
});

test('OKF: a link on the metadata card navigates in the tab, and Back returns', async () => {
  await closeEverything();
  const html = await openOkf('decisions', 'read-replicas.md');
  // resolves: [incidents/db-outage] — a Concept ID, resolved against the bundle root.
  const ids = linkIdsTo(html, '/okf/handbook/wiki/incidents/db-outage.md');
  assert.ok(ids.length >= 1, 'the card links to incidents/db-outage.md');
  assert.match(html, /<section class="mdx-card/);

  assert.ok(getApi().clickRenderedLink(ids[0]));
  const snapshot = await waitFor('the preview to move to incidents/db-outage.md', () => {
    const current = getApi().activePreview;
    return current?.uri.endsWith('/incidents/db-outage.md') ? current : undefined;
  });
  assert.equal(snapshot.title, 'db-outage.md');
  assert.equal(allTabs().length, 1, `navigation must not open a tab: ${describeTabs()}`);

  await new Promise((resolve) => setTimeout(resolve, 200));
  getApi().goBack();
  const back = await waitFor('Back to decisions/read-replicas.md', () => {
    const current = getApi().activePreview;
    return current?.uri.endsWith('/decisions/read-replicas.md') ? current : undefined;
  });
  assert.equal(back.departureLinkId, ids[0], 'Back remembers the card link that was followed');
});

test('OKF: hovering a link asks for the linked page\'s title and description', async () => {
  const html = await openOkf('decisions', 'read-replicas.md');
  const target = /data-mdx-target="([^"]*\/wiki\/incidents\/db-outage\.md)"/.exec(html)?.[1];
  assert.ok(target, 'the page links to incidents/db-outage.md');
  const answer = await getApi().peek(target.replace(/&amp;/g, '&'));
  assert.equal(answer?.found, true);
  assert.equal(answer?.title, 'Primary database outage');
  assert.match(answer?.description ?? '', /^Write traffic saturated the primary/);

  const missing = await getApi().peek(target.replace('db-outage.md', 'nope.md'));
  assert.equal(missing?.found, false);
});

test('OKF: Back to a link inside the Details fold reopens the fold and lands on the link', async () => {
  await closeEverything();
  const html = await openOkf('decisions', 'read-replicas.md');
  // Extension keys such as `resolves:` are not on the header line, so they sit inside the
  // fold. Take the first card link under <details>.
  const fold = /<details class="mdx-card-details"[\s\S]*?<\/details>/.exec(html)?.[0] ?? '';
  const inFold = [...fold.matchAll(/<a data-mdx-link="(\d+)" data-mdx-kind="markdown"/g)].map((m) => Number(m[1]));
  assert.ok(inFold.length > 0, 'a markdown link inside the fold');

  assert.ok(getApi().clickRenderedLink(inFold[0]));
  await waitFor('the preview to leave read-replicas.md', () => !getApi().activePreview?.uri.endsWith('/decisions/read-replicas.md'));
  await new Promise((resolve) => setTimeout(resolve, 200));
  getApi().goBack();

  const settled = await waitFor('Back to settle on read-replicas.md', () => {
    const current = getApi().activePreview;
    const scroll = current?.lastScroll;
    return current?.uri.endsWith('/decisions/read-replicas.md') && scroll?.mode === 'back' && scroll.final ? scroll : undefined;
  }, 10000);
  assert.equal(settled.anchored, true, 'the link was found with a box to scroll to');
});

test('OKF: card labels follow the display language', async () => {
  const html = await openOkf('incidents', 'db-outage.md');
  if (vscode.env.language.startsWith('ja')) {
    assert.match(html, />未検証</);
    assert.match(html, /<div class="mdx-card-section">出典<\/div>/);
  } else {
    assert.match(html, />unverified</);
    assert.match(html, /<div class="mdx-card-section">Sources<\/div>/);
  }
});
