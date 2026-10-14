import * as vscode from 'vscode';
import { readDocumentText } from '../documentText';
import { log } from '../log';

/** What a link to a Markdown page can show about the page before it is opened. */
export interface TargetMeta {
  title?: string;
  description?: string;
  type?: string;
  status?: string;
}

const LIMIT = 1000;

function text(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.trim() || undefined;
  }
  return typeof value === 'number' || typeof value === 'boolean' ? String(value) : undefined;
}

/**
 * Front matter summaries of Markdown files, for link labels and hover cards.
 *
 * Entries are dropped when the file changes on disk; the least recently used go first
 * once the cache is full.
 */
export class MetaCache implements vscode.Disposable {
  private readonly entries = new Map<string, Promise<TargetMeta | undefined>>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{md,markdown,mdown,mkd,mkdn}');
    const drop = (uri: vscode.Uri) => this.entries.delete(uri.toString());
    this.disposables.push(watcher, watcher.onDidChange(drop), watcher.onDidDelete(drop), watcher.onDidCreate(drop));
  }

  get(uri: vscode.Uri): Promise<TargetMeta | undefined> {
    const key = uri.toString();
    let entry = this.entries.get(key);
    if (entry) {
      // Re-insert so iteration order tracks recency.
      this.entries.delete(key);
    } else {
      entry = this.read(uri);
    }
    this.entries.set(key, entry);
    if (this.entries.size > LIMIT) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
      }
    }
    return entry;
  }

  private async read(uri: vscode.Uri): Promise<TargetMeta | undefined> {
    try {
      const { readFrontMatter } = await import('../renderer/frontMatter');
      const source = await readDocumentText(uri);
      const data = readFrontMatter(source) ?? {};
      const meta: TargetMeta = {
        title: text(data.title),
        description: text(data.description),
        type: text(data.type),
        status: text(data.status),
      };
      if (!meta.title) {
        // No title key: the page's first heading is what a reader would call it.
        meta.title = /^#\s+(.+?)\s*#*\s*$/m.exec(source)?.[1];
      }
      return meta;
    } catch (error) {
      log.debug(`could not read front matter of ${uri.path}`, error);
      this.entries.delete(uri.toString());
      return undefined;
    }
  }

  dispose(): void {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
    this.entries.clear();
  }
}
