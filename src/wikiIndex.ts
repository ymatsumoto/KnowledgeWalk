import * as vscode from 'vscode';
import * as path from 'path';
import { log } from './log';
import { readConfig } from './config';

const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd', '.mkdn'];
const ASSET_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif', '.bmp', '.ico', '.pdf',
];
const INDEXED = [...MARKDOWN_EXTENSIONS, ...ASSET_EXTENSIONS];
const GLOB = `**/*{${INDEXED.join(',')}}`;
const EXCLUDE = '**/{node_modules,.git,.venv,dist,out}/**';
const MAX_FILES = 20000;

function isUnder(uri: vscode.Uri, root: vscode.Uri): boolean {
  return (
    uri.scheme === root.scheme &&
    uri.authority === root.authority &&
    (uri.path === root.path || uri.path.startsWith(`${root.path}/`))
  );
}

export interface ResolvedWikiLink {
  uri: vscode.Uri;
  /** False when nothing in the workspace matches; the link is shown as unresolved. */
  exists: boolean;
  /** True when the name was found outside the document's own wiki. */
  crossWiki?: boolean;
}

/**
 * What to do when a name is not in the document's own wiki.
 *
 *  - `unique`  look across the workspace and accept the match only if there is exactly
 *              one, so a note in another project can be linked without any extra syntax
 *              while an ambiguous name stays unresolved rather than being guessed at
 *  - `none`    stay inside the wiki
 */
export type WikiLinkFallback = 'unique' | 'none';

export interface ResolveOptions {
  /** Subtree the link is resolved within; see rootFor. */
  root?: vscode.Uri;
  fallback?: WikiLinkFallback;
}

/**
 * Name index for Obsidian-style `[[wiki links]]`.
 *
 * A wiki link names a note rather than a path — `[[Sequencing pipeline]]` refers to
 * whichever file in the vault is called that, wherever it happens to live — so resolving
 * one needs to know every file in the workspace, not just the current directory.
 */
export class WikiLinkIndex implements vscode.Disposable {
  /** Lower-cased basename without extension -> the files that answer to that name. */
  private byName = new Map<string, vscode.Uri[]>();
  /** Lower-cased full path -> file, for existence checks. */
  private byPath = new Map<string, vscode.Uri>();
  /** Directory -> the vault root found by walking up from it. */
  private readonly rootCache = new Map<string, vscode.Uri | undefined>();
  private building: Promise<void> | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    const watcher = vscode.workspace.createFileSystemWatcher(GLOB);
    this.disposables.push(
      watcher,
      watcher.onDidCreate(() => this.invalidate()),
      watcher.onDidDelete(() => this.invalidate()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.invalidate())
    );
  }

  /** Build the index if it is missing or stale. Cheap once warm. */
  async ensure(): Promise<void> {
    this.building ??= this.build();
    await this.building;
  }

  /**
   * Whether `uri` is a file the index knows about: Markdown or a common asset. Answers
   * only once `ensure()` has finished; anything else needs a `stat`.
   */
  has(uri: vscode.Uri): boolean {
    return this.byPath.has(uri.path.toLowerCase());
  }

  private invalidate(): void {
    this.building = undefined;
    this.rootCache.clear();
  }

  /**
   * Which subtree a document's wiki links are resolved within.
   *
   * In order of precedence:
   *
   *  1. a `root:` key in the document's own YAML front matter;
   *  2. the nearest ancestor holding one of `mdExplorer.wikiRootMarkers` — `.obsidian`
   *     by default, i.e. an actual Obsidian vault;
   *  3. the workspace folder holding the document;
   *  4. the document's own directory.
   *
   * A `root:` value is read in one of three ways, and the first is the one to prefer:
   *
   *  - a bare name (`root: handbook`) is the nearest **ancestor directory** with that
   *    name, so every page of the wiki carries the same literal value no matter how
   *    deeply it sits;
   *  - a path (`root: ..`, `root: ../..`) is relative to the document, which means the
   *    value differs per page and has to be recomputed whenever a page moves;
   *  - an absolute path is used as given, and stops working the moment the wiki is
   *    cloned, moved or mounted somewhere else.
   */
  async rootFor(uri: vscode.Uri, declared?: unknown): Promise<vscode.Uri | undefined> {
    if (typeof declared === 'string' && declared.trim()) {
      const resolved = this.fromDeclaredRoot(uri, declared.trim());
      if (resolved) {
        log.debug(`wiki root declared in front matter: ${resolved.path}`);
        return resolved;
      }
      log.warn(`front matter root "${String(declared).trim()}" not found above ${uri.path}`);
    }

    const directory = path.posix.dirname(uri.path);
    const fallback =
      vscode.workspace.getWorkspaceFolder(uri)?.uri ??
      uri.with({ path: directory, query: '', fragment: '' });

    try {
      if (!this.rootCache.has(directory)) {
        this.rootCache.set(directory, await this.findVaultRoot(uri));
      }
      return this.rootCache.get(directory) ?? fallback;
    } catch (error) {
      // Never let root detection cost us the document.
      log.warn(`could not determine a wiki root for ${uri.path}`, error);
      return fallback;
    }
  }

  private fromDeclaredRoot(uri: vscode.Uri, value: string): vscode.Uri | undefined {
    if (value.startsWith('/')) {
      return uri.with({ path: path.posix.normalize(value), query: '', fragment: '' });
    }
    if (value.includes('/') || value === '.' || value === '..') {
      return this.relativeTo(uri, value);
    }
    return this.ancestorNamed(uri, value);
  }

  /** The nearest directory above `uri` called `name`. */
  private ancestorNamed(uri: vscode.Uri, name: string): vscode.Uri | undefined {
    let directory = path.posix.dirname(uri.path);
    for (let depth = 0; depth < 64; depth++) {
      if (path.posix.basename(directory) === name) {
        return uri.with({ path: directory, query: '', fragment: '' });
      }
      const parent = path.posix.dirname(directory);
      if (parent === directory) {
        return undefined;
      }
      directory = parent;
    }
    return undefined;
  }

  /** Walk up looking for a root marker, stopping at the workspace folder or the root. */
  private async findVaultRoot(uri: vscode.Uri): Promise<vscode.Uri | undefined> {
    const markers = readConfig(uri).wikiRootMarkers;
    if (markers.length === 0) {
      return undefined;
    }
    const boundary = vscode.workspace.getWorkspaceFolder(uri)?.uri.path;
    let directory = path.posix.dirname(uri.path);
    for (let depth = 0; depth < 32; depth++) {
      for (const marker of markers) {
        // path.posix.join, not interpolation: at the filesystem root that would produce
        // `//.obsidian`, and a URI with no authority may not have a path starting `//`.
        const candidate = uri.with({
          path: path.posix.join(directory, marker),
          query: '',
          fragment: '',
        });
        try {
          await vscode.workspace.fs.stat(candidate);
          return uri.with({ path: directory, query: '', fragment: '' });
        } catch {
          // Not here; try the next marker, then the parent directory.
        }
      }
      if (directory === boundary || directory === '/' || directory === '.') {
        return undefined;
      }
      const parent = path.posix.dirname(directory);
      if (parent === directory) {
        return undefined;
      }
      directory = parent;
    }
    return undefined;
  }

  private async build(): Promise<void> {
    this.byName.clear();
    this.byPath.clear();
    if (!vscode.workspace.workspaceFolders?.length) {
      return;
    }

    const files = await vscode.workspace.findFiles(GLOB, EXCLUDE, MAX_FILES);
    if (files.length === MAX_FILES) {
      log.warn(`wiki link index truncated at ${MAX_FILES} files`);
    }
    for (const uri of files) {
      const base = path.posix.basename(uri.path);
      const stem = base.slice(0, base.length - path.posix.extname(base).length).toLowerCase();
      const existing = this.byName.get(stem);
      if (existing) {
        existing.push(uri);
      } else {
        this.byName.set(stem, [uri]);
      }

      this.byPath.set(uri.path.toLowerCase(), uri);
    }
    log.debug(`wiki link index: ${files.length} files, ${this.byName.size} names`);
  }

  /**
   * Resolve a wiki link target.
   *
   * A target containing a slash is a path from the workspace root, falling back to a path
   * relative to the document. A bare name is looked up in the index, preferring a file in
   * the same folder as the document and then the shortest path.
   */
  resolve(
    target: string,
    from: vscode.Uri,
    { root, fallback = 'unique' }: ResolveOptions = {}
  ): ResolvedWikiLink | undefined {
    const cleaned = target.trim().replace(/^\.\//, '');
    if (!cleaned) {
      return undefined;
    }

    const hasExtension = INDEXED.includes(path.posix.extname(cleaned).toLowerCase());
    const withExtension = hasExtension ? cleaned : `${cleaned}.md`;

    if (cleaned.includes('/')) {
      // A path is read from the wiki root first, then relative to the document.
      const candidates = [
        root ? this.join(root, withExtension) : undefined,
        this.relativeTo(from, withExtension),
      ].filter((candidate): candidate is vscode.Uri => candidate !== undefined);
      for (const candidate of candidates) {
        const indexed = this.byPath.get(candidate.path.toLowerCase());
        if (indexed) {
          return { uri: indexed, exists: true };
        }
      }
      return { uri: candidates[candidates.length - 1], exists: false };
    }

    const stem = (hasExtension
      ? withExtension.slice(0, withExtension.length - path.posix.extname(withExtension).length)
      : cleaned
    ).toLowerCase();
    const all = this.byName.get(stem) ?? [];
    const withinWiki = root ? all.filter((candidate) => isUnder(candidate, root)) : all;
    if (withinWiki.length) {
      return { uri: this.pick(withinWiki, from), exists: true };
    }

    // Not in this wiki. A note may well live in a neighbouring project that grew its own
    // links into this one later; accept that only when the name picks out one file, so an
    // ambiguous name is never resolved to an arbitrary project.
    if (fallback === 'unique' && root && all.length === 1) {
      log.debug(`wiki link "${target}" resolved outside ${root.path}: ${all[0].path}`);
      return { uri: all[0], exists: true, crossWiki: true };
    }

    // Nothing usable: point at the sibling the name implies, and say so.
    const guess = this.relativeTo(from, withExtension);
    return { uri: guess, exists: this.byPath.has(guess.path.toLowerCase()) };
  }

  private join(base: vscode.Uri, relative: string): vscode.Uri {
    return base.with({
      path: path.posix.normalize(path.posix.join(base.path, relative)),
      query: '',
      fragment: '',
    });
  }

  private relativeTo(from: vscode.Uri, relative: string): vscode.Uri {
    return from.with({
      path: path.posix.normalize(path.posix.join(path.posix.dirname(from.path), relative)),
      query: '',
      fragment: '',
    });
  }

  /**
   * Break ties by nearness to the document: the same folder first, then whichever
   * candidate shares the longest directory prefix with it, then the shallowest path. A
   * note in a sibling folder of the same wiki should always beat a same-named note in an
   * unrelated part of the workspace.
   */
  private pick(candidates: vscode.Uri[], from: vscode.Uri): vscode.Uri {
    const fromSegments = path.posix.dirname(from.path).split('/');
    const sharedDepth = (candidate: vscode.Uri) => {
      const segments = path.posix.dirname(candidate.path).split('/');
      let shared = 0;
      while (shared < segments.length && shared < fromSegments.length && segments[shared] === fromSegments[shared]) {
        shared += 1;
      }
      return shared;
    };
    return [...candidates].sort(
      (a, b) =>
        sharedDepth(b) - sharedDepth(a) ||
        a.path.split('/').length - b.path.split('/').length ||
        a.path.localeCompare(b.path)
    )[0];
  }

  dispose(): void {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }
}
