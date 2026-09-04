import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { NavigationHistory } from '../src/history';

test('a fresh history has nowhere to go', () => {
  const history = new NavigationHistory(10);
  assert.equal(history.current, undefined);
  assert.equal(history.canGoBack, false);
  assert.equal(history.canGoForward, false);
});

test('following a link stamps the departure link onto the page being left', () => {
  const history = new NavigationHistory(10);
  history.push('file:///a.md');
  history.push('file:///b.md', undefined, 7);

  assert.equal(history.current?.uri, 'file:///b.md');
  assert.equal(history.canGoBack, true);
  assert.equal(history.canGoForward, false);

  history.back();
  // This is what Back scrolls to: the anchor that was clicked on a.md.
  assert.equal(history.current?.uri, 'file:///a.md');
  assert.equal(history.current?.linkId, 7);
});

test('back and forward walk the stack without losing entries', () => {
  const history = new NavigationHistory(10);
  history.push('file:///a.md');
  history.push('file:///b.md', undefined, 1);
  history.push('file:///c.md', undefined, 2);

  assert.equal(history.back(), true);
  assert.equal(history.back(), true);
  assert.equal(history.current?.uri, 'file:///a.md');
  assert.equal(history.back(), false, 'must not walk past the first entry');

  assert.equal(history.forward(), true);
  assert.equal(history.current?.uri, 'file:///b.md');
  assert.equal(history.forward(), true);
  assert.equal(history.current?.uri, 'file:///c.md');
  assert.equal(history.forward(), false, 'must not walk past the last entry');
});

test('navigating after going back discards the forward branch', () => {
  const history = new NavigationHistory(10);
  history.push('file:///a.md');
  history.push('file:///b.md', undefined, 1);
  history.push('file:///c.md', undefined, 2);

  history.back();
  history.push('file:///d.md', undefined, 5);

  assert.equal(history.current?.uri, 'file:///d.md');
  assert.equal(history.canGoForward, false);
  assert.equal(history.length, 3, 'a.md, b.md, d.md');

  history.back();
  assert.equal(history.current?.uri, 'file:///b.md');
  assert.equal(history.current?.linkId, 5, 'the link followed out of b.md was recorded');
});

test('a fragment link is a history entry of its own', () => {
  const history = new NavigationHistory(10);
  history.push('file:///a.md');
  history.push('file:///a.md', 'section-2', 4);

  assert.equal(history.current?.fragment, 'section-2');
  history.back();
  assert.equal(history.current?.fragment, undefined);
  assert.equal(history.current?.linkId, 4);
});

test('the oldest entries are dropped once the limit is reached', () => {
  const history = new NavigationHistory(3);
  for (const name of ['a', 'b', 'c', 'd', 'e']) {
    history.push(`file:///${name}.md`, undefined, 0);
  }

  assert.equal(history.length, 3);
  assert.equal(history.current?.uri, 'file:///e.md');
  history.back();
  history.back();
  assert.equal(history.current?.uri, 'file:///c.md');
  assert.equal(history.canGoBack, false);
});

test('state survives a round trip through serialisation', () => {
  const history = new NavigationHistory(10);
  history.push('file:///a.md');
  history.push('file:///b.md', 'intro', 3);
  history.back();

  const restored = NavigationHistory.fromState(history.snapshot(), 10);
  assert.equal(restored.current?.uri, 'file:///a.md');
  assert.equal(restored.current?.linkId, 3);
  assert.equal(restored.canGoForward, true);
  restored.forward();
  assert.equal(restored.current?.fragment, 'intro');
});

test('a restored index is clamped to the entries that are actually present', () => {
  const restored = NavigationHistory.fromState(
    { history: [{ uri: 'file:///a.md' }], index: 9 },
    10
  );
  assert.equal(restored.current?.uri, 'file:///a.md');
  assert.equal(restored.canGoForward, false);
});
