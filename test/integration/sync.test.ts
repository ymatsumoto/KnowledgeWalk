import * as vscode from 'vscode';
import * as path from 'path';
import { assert, getApi, test, waitFor } from './harness';
import { closeEverything, describeTabs } from './shared';

const FIXTURES = path.join(__dirname, '..', '..', 'test', 'fixtures');
const scrollMd = vscode.Uri.file(path.join(FIXTURES, 'scroll.md'));

/** Deep enough into the fixture that the preview has to scroll to reach it. */
const CURSOR_LINE = 120;

function preview() {
  return getApi().previews.find((candidate) => candidate.uri.endsWith('fixtures/scroll.md'));
}

async function textEditorFor(uri: vscode.Uri): Promise<vscode.TextEditor> {
  return waitFor(`a text editor for ${path.basename(uri.fsPath)} (tabs: ${describeTabs()})`, () => {
    const editor = vscode.window.activeTextEditor;
    return editor?.document.uri.fsPath === uri.fsPath ? editor : undefined;
  });
}

/** Wait for the settle report that belongs to this navigation; see scroll.test.ts. */
async function settled(since: number) {
  return waitFor(
    'the preview to settle',
    () => {
      const scroll = preview()?.lastScroll;
      return scroll && scroll.final && scroll.at >= since ? scroll : undefined;
    },
    10000
  );
}

test('Open in Editor from a fresh preview still opens the file', async () => {
  await closeEverything();
  await vscode.commands.executeCommand('vscode.open', scrollMd);
  await waitFor('the preview page to load', () => getApi().activePreview?.isReady, 15000);

  await vscode.commands.executeCommand('mdExplorer.switchToEditor');
  const editor = await textEditorFor(scrollMd);

  // Nothing has been read yet, so there is no position to restore: the top is right.
  assert.equal(editor.selection.active.line, 0);
});

test('Open Preview opens at the cursor rather than the top of the file', async () => {
  const editor = await textEditorFor(scrollMd);
  editor.selection = new vscode.Selection(CURSOR_LINE, 0, CURSOR_LINE, 0);

  const since = Date.now();
  await vscode.commands.executeCommand('mdExplorer.showPreview');
  await waitFor('the preview page to load', () => getApi().activePreview?.isReady, 15000);

  const scroll = await settled(since);
  assert.equal(scroll.anchored, true, 'the cursor line should have been found in the page');
  assert.ok(scroll.scrollTop > 0, `the preview should not sit at the top (was ${scroll.scrollTop})`);
});

test('the page reports the passage it came to rest on', async () => {
  const line = await waitFor(
    'a reported reading position',
    () => preview()?.line,
    5000
  );

  // `data-line` sits on block-level tokens, so the report names the block that holds the
  // cursor's line, never a line after it.
  assert.ok(line > 0, 'the reported line should be inside the document, not its first block');
  assert.ok(
    line <= CURSOR_LINE,
    `the reported line ${line} should be at or before the cursor line ${CURSOR_LINE}`
  );
});

test('Open in Editor comes back to the passage that was on screen', async () => {
  const reported = preview()?.line;
  assert.equal(typeof reported, 'number', 'the page must have reported a position first');

  await vscode.commands.executeCommand('mdExplorer.switchToEditor');
  const editor = await textEditorFor(scrollMd);

  assert.equal(editor.selection.active.line, reported);
  assert.ok(
    editor.visibleRanges.some(
      (range) => range.start.line <= reported! && reported! <= range.end.line
    ),
    'the line the reader was on should have been revealed, not left off screen'
  );
});
