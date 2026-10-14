import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { assert, test, waitFor } from './harness';
import { closeEverything, SAMPLES } from './shared';

/**
 * The JSON schema contributed for knowledgeWalk.frontMatterDisplay should drive VS Code's
 * own completion and validation in settings.json. Uses a throwaway folder settings
 * file, removed afterwards so it cannot leak into other cases.
 */
const dir = path.join(SAMPLES, '.vscode');
const file = path.join(dir, 'settings.json');

const SETTINGS = `{
  "knowledgeWalk.frontMatterDisplay": {
    "fields": {
      "stage": { "as": "" },
      "severity": { "as": "badge", "colors": { "high": "magenta" } }
    },
    "details": "open"
  }
}
`;

async function labelsAt(doc: vscode.TextDocument, needle: string, offset: number): Promise<string[]> {
  const position = doc.positionAt(doc.getText().indexOf(needle) + offset);
  const list = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider',
    doc.uri,
    position
  );
  return list.items.map((item) => (typeof item.label === 'string' ? item.label : item.label.label).replace(/"/g, ''));
}

test('settings.json: the display setting completes and validates against its schema', async () => {
  await closeEverything();
  const existed = fs.existsSync(dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, SETTINGS);
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    await vscode.window.showTextDocument(doc);

    const kinds = await waitFor(
      'completion of an `as` value',
      async () => {
        const labels = await labelsAt(doc, '"as": ""', 7);
        // Not "badge": that word is in the file, and word-based suggestions would match it.
        return labels.includes('auto') ? labels : undefined;
      },
      30000
    );
    for (const kind of ['auto', 'chips', 'links', 'template', 'hidden']) {
      assert.ok(kinds.includes(kind), `"${kind}" offered: ${kinds.join(', ')}`);
    }

    const keys = await labelsAt(doc, '"details"', 0);
    for (const key of ['header', 'hidden', 'byType']) {
      assert.ok(keys.includes(key), `setting "${key}" offered: ${keys.join(', ')}`);
    }

    const problems = await waitFor('schema diagnostics', () => {
      const found = vscode.languages.getDiagnostics(doc.uri).map((d) => d.message);
      return found.length >= 2 ? found : undefined;
    }, 15000);
    const text = problems.join('\n');
    assert.match(text, /magenta|Value is not accepted/i, text);
  } finally {
    await closeEverything();
    fs.rmSync(file, { force: true });
    if (!existed) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});
