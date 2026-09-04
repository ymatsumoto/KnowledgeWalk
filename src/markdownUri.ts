import type * as vscode from 'vscode';

const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd', '.mkdn'];

export function isMarkdownUri(uri: vscode.Uri): boolean {
  const lower = uri.path.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

