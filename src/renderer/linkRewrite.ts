import * as vscode from 'vscode';
import * as path from 'path';
import type { LinkKind } from '../protocol';

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mkdn']);

/** Schemes that should be handed to the OS / VS Code rather than resolved as a file. */
const EXTERNAL_SCHEMES = new Set([
  'http',
  'https',
  'mailto',
  'tel',
  'ftp',
  'command',
  'vscode',
  'vscode-insiders',
]);

/** Schemes that address something VS Code can open as a document. */
const DOCUMENT_SCHEMES = new Set(['file', 'vscode-remote', 'vscode-vfs', 'untitled']);

export interface ClassifiedLink {
  kind: LinkKind;
  /** Resolved document URI for `markdown` / `file` / `anchor` links. */
  target?: vscode.Uri;
  /** Original href, kept for `external` links. */
  href?: string;
  fragment?: string;
}

function safeDecode(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function isMarkdown(uri: vscode.Uri): boolean {
  return MARKDOWN_EXTENSIONS.has(path.posix.extname(uri.path).toLowerCase());
}

/**
 * Resolve a relative or root-relative href against the document that contains it.
 * Root-relative paths (`/docs/a.md`) are resolved against the workspace folder when
 * there is one, and against the document's own folder otherwise.
 */
export function resolveRelative(base: vscode.Uri, relative: string): vscode.Uri {
  if (relative.startsWith('/')) {
    const folder = vscode.workspace.getWorkspaceFolder(base);
    const root = folder ? folder.uri : base.with({ path: path.posix.dirname(base.path) });
    return root.with({
      path: path.posix.join(root.path, relative),
      query: '',
      fragment: '',
    });
  }
  const dir = path.posix.dirname(base.path);
  return base.with({
    path: path.posix.normalize(path.posix.join(dir, relative)),
    query: '',
    fragment: '',
  });
}

/** Decide what clicking a link in the preview should do. */
export function classifyLink(href: string, base: vscode.Uri): ClassifiedLink {
  const raw = href.trim();
  if (!raw) {
    return { kind: 'unknown' };
  }

  if (raw.startsWith('#')) {
    return { kind: 'anchor', target: base, fragment: safeDecode(raw.slice(1)) };
  }

  const scheme = /^([a-z][a-z0-9+.\-]*):/i.exec(raw)?.[1]?.toLowerCase();
  if (scheme) {
    if (EXTERNAL_SCHEMES.has(scheme)) {
      return { kind: 'external', href: raw };
    }
    if (DOCUMENT_SCHEMES.has(scheme)) {
      const uri = vscode.Uri.parse(raw);
      const target = uri.with({ fragment: '' });
      return {
        kind: isMarkdown(target) ? 'markdown' : 'file',
        target,
        fragment: uri.fragment || undefined,
      };
    }
    // Unknown schemes (data:, custom protocols) are safest handed to the shell.
    return { kind: 'external', href: raw };
  }

  const hashIndex = raw.indexOf('#');
  const pathPart = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const fragment = hashIndex >= 0 ? safeDecode(raw.slice(hashIndex + 1)) : undefined;

  if (!pathPart) {
    return { kind: 'anchor', target: base, fragment };
  }

  const target = resolveRelative(base, safeDecode(pathPart.split('?')[0]));
  return { kind: isMarkdown(target) ? 'markdown' : 'file', target, fragment };
}

/**
 * Resolve an `<img src>` to a URI the webview may load.
 * Returns undefined when the source should be left untouched (remote or inline data).
 */
export function resolveResource(src: string, base: vscode.Uri): vscode.Uri | undefined {
  const raw = src.trim();
  if (!raw) {
    return undefined;
  }
  const scheme = /^([a-z][a-z0-9+.\-]*):/i.exec(raw)?.[1]?.toLowerCase();
  if (scheme) {
    if (DOCUMENT_SCHEMES.has(scheme)) {
      return vscode.Uri.parse(raw);
    }
    return undefined;
  }
  return resolveRelative(base, safeDecode(raw.split('#')[0].split('?')[0]));
}
