import * as vscode from 'vscode';

const decoder = new TextDecoder('utf-8');

/**
 * The text to preview for `uri`.
 *
 * When the file is already open in an editor its in-memory contents are used, so the
 * preview follows unsaved edits. Otherwise the bytes are read straight from disk:
 * `workspace.openTextDocument` would build a text model and wake the Markdown language
 * server for every file the reader merely glances at, which measured in the hundreds of
 * milliseconds — and over a second for a cold file.
 */
export async function readDocumentText(uri: vscode.Uri): Promise<string> {
  const key = uri.toString();
  const open = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === key);
  if (open) {
    return open.getText();
  }
  return decoder.decode(await vscode.workspace.fs.readFile(uri));
}
