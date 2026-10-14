import * as vscode from 'vscode';
import * as path from 'path';
import { log } from '../log';
import { readDocumentText } from '../documentText';
import type { WikiLinkIndex } from '../wikiIndex';
import { looksLikePath, resolveRef, type RefContext } from './pathResolver';
import { displayForType, mergeDisplay, type DisplayConfig } from './displayConfig';
import { MetaCache, type TargetMeta } from './metaCache';

/** Per-wiki display settings live in this file at the wiki root. */
export const LOCAL_CONFIG_FILE = '.mdexplorer.yaml';

/** The two roots a document's references are resolved against. */
export interface DocRoots {
  /**
   * `root:` in front matter, a root marker, the workspace folder, or the document's own
   * directory — see WikiLinkIndex.rootFor. Scope of `[[wiki links]]`.
   */
  wikiRoot: vscode.Uri;
  /**
   * The nearest directory at or below the wiki root holding an `index.md` that declares
   * `okf_version`; the wiki root itself when there is none. Base of OKF Concept IDs and
   * of `/`-prefixed links.
   */
  bundleRoot: vscode.Uri;
  /** `okf_version` from the bundle's `index.md`, when the document is in a bundle. */
  okfVersion?: string;
}

/** Everything about a document that has to be looked up before it can be rendered. */
export interface PreparedDocument {
  roots: DocRoots;
  /** Parsed front matter, when the document has a usable block. */
  frontMatter?: Record<string, unknown>;
  /** Synchronous existence check for a file on the document's filesystem. */
  exists(p: string): boolean;
  /** Whether `p` is a directory, for paths that were checked on disk. */
  isDirectory(p: string): boolean;
  /** The context `resolveRef` needs for this document. */
  refContext: RefContext;
  /** Card layout for this document: defaults, settings, `.mdexplorer.yaml`, `byType`. */
  display: DisplayConfig;
  /** Summaries of the Markdown pages front matter links to, keyed by path. */
  targets: Map<string, TargetMeta>;
}

/**
 * How long a render waits for the titles of linked pages. Past this the card shows the
 * paths as written; titles that arrive later are used the next time the page renders,
 * rather than re-rendering and moving the page under the reader.
 */
const TARGET_BUDGET_MS = 150;
const TARGET_CONCURRENCY = 16;

/** More than enough for any real page; a guard against a pathological document. */
const MAX_STATS = 200;
const BODY_ROOT_LINK = /\]\((\/[^)\s]+)/g;

function collectStrings(value: unknown, into: string[]): void {
  if (typeof value === 'string') {
    into.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, into));
  } else if (value && typeof value === 'object' && !(value instanceof Date)) {
    Object.values(value as Record<string, unknown>).forEach((item) => collectStrings(item, into));
  }
}

/**
 * Per-workspace knowledge about OKF bundles: where they start, and which of the files a
 * document mentions actually exist.
 */
export class OkfService implements vscode.Disposable {
  /** Directory -> `okf_version` of its `index.md`, or null when it is not a bundle root. */
  private readonly bundleDirs = new Map<string, string | null>();
  /** Wiki root -> the `frontMatter:` section of its `.mdexplorer.yaml`, if any. */
  private readonly localDisplay = new Map<string, Promise<unknown>>();
  /** Configuration problems already reported, so each is logged once. */
  private readonly reported = new Set<string>();
  private readonly displayChanged = new vscode.EventEmitter<void>();
  /** Fires when a `.mdexplorer.yaml` changes, so open previews can re-render. */
  readonly onDidChangeDisplay = this.displayChanged.event;
  private readonly disposables: vscode.Disposable[] = [];
  readonly meta = new MetaCache();

  constructor(private readonly index: WikiLinkIndex) {
    const indexWatcher = vscode.workspace.createFileSystemWatcher('**/index.md');
    const invalidateBundles = () => this.bundleDirs.clear();
    const configWatcher = vscode.workspace.createFileSystemWatcher(`**/${LOCAL_CONFIG_FILE}`);
    const invalidateDisplay = () => {
      this.localDisplay.clear();
      this.reported.clear();
      this.displayChanged.fire();
    };
    this.disposables.push(
      indexWatcher,
      indexWatcher.onDidCreate(invalidateBundles),
      indexWatcher.onDidChange(invalidateBundles),
      indexWatcher.onDidDelete(invalidateBundles),
      configWatcher,
      configWatcher.onDidCreate(invalidateDisplay),
      configWatcher.onDidChange(invalidateDisplay),
      configWatcher.onDidDelete(invalidateDisplay),
      this.displayChanged,
      this.meta
    );
  }

  /**
   * @param userDisplay the `mdExplorer.frontMatterDisplay` setting, layered between the
   *   built-in defaults and the wiki's own `.mdexplorer.yaml`.
   */
  async prepare(uri: vscode.Uri, text: string, userDisplay?: unknown): Promise<PreparedDocument> {
    await this.index.ensure();
    const { readFrontMatter } = await import('../renderer/frontMatter');
    const frontMatter = readFrontMatter(text);
    const roots = await this.rootsFor(uri, frontMatter?.root);
    const refContext: RefContext = {
      docDir: path.posix.dirname(uri.path),
      bundleRoot: roots.bundleRoot.path,
      wikiRoot: roots.wikiRoot.path,
    };

    // Everything the index cannot answer — files outside the workspace, extensions it
    // does not track — is checked on disk now, so rendering can stay synchronous.
    const unknown = new Set<string>();
    const probe = (p: string) => {
      if (this.index.has(uri.with({ path: p }))) {
        return true;
      }
      unknown.add(p);
      return false;
    };
    const values: string[] = [];
    collectStrings(frontMatter, values);
    for (const value of values) {
      if (looksLikePath(value)) {
        resolveRef(value, refContext, probe);
      }
    }
    // A body link may also mean the workspace folder, as it did before bundles, or the
    // filesystem root; see resolveRelative.
    const folder = vscode.workspace.getWorkspaceFolder(uri)?.uri.path;
    for (const match of text.matchAll(BODY_ROOT_LINK)) {
      const target = match[1].split(/[?#]/)[0];
      for (const base of [refContext.bundleRoot, folder, '/']) {
        if (base) {
          probe(path.posix.join(base, target));
        }
      }
    }
    const onDisk = new Set<string>();
    const directories = new Set<string>();
    await Promise.all(
      [...unknown].slice(0, MAX_STATS).map(async (p) => {
        try {
          const stat = await vscode.workspace.fs.stat(uri.with({ path: p, query: '', fragment: '' }));
          // A directory is not something a link can open; it is remembered so it is
          // not reported as missing either.
          if (stat.type & vscode.FileType.Directory) {
            directories.add(p);
          } else {
            onDisk.add(p);
          }
        } catch {
          // Does not exist; nothing to record.
        }
      })
    );

    const exists = (p: string) => onDisk.has(p) || this.index.has(uri.with({ path: p }));
    const targets = await this.targetsOf(uri, values, refContext, exists);

    const local = await this.loadLocalDisplay(roots.wikiRoot);
    const merged = mergeDisplay(userDisplay, local);
    const type = typeof frontMatter?.type === 'string' ? frontMatter.type : undefined;
    const forType = displayForType(merged.config, type);
    this.report(roots.wikiRoot, [...merged.warnings, ...forType.warnings]);

    return {
      roots,
      frontMatter,
      refContext,
      display: forType.config,
      targets,
      exists,
      isDirectory: (p: string) => directories.has(p),
    };
  }

  /** Titles of the Markdown pages the front matter links to, within the time budget. */
  private async targetsOf(
    uri: vscode.Uri,
    values: string[],
    refContext: RefContext,
    exists: (p: string) => boolean
  ): Promise<Map<string, TargetMeta>> {
    const paths = new Set<string>();
    for (const value of values) {
      if (looksLikePath(value)) {
        const ref = resolveRef(value, refContext, exists);
        if (ref.kind === 'file' && ref.isMarkdown) {
          paths.add(ref.path);
        }
      }
    }
    const targets = new Map<string, TargetMeta>();
    if (paths.size === 0) {
      return targets;
    }
    const queue = [...paths];
    const worker = async () => {
      for (let p = queue.shift(); p !== undefined; p = queue.shift()) {
        const meta = await this.meta.get(uri.with({ path: p, query: '', fragment: '' }));
        if (meta) {
          targets.set(p, meta);
        }
      }
    };
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.all(Array.from({ length: Math.min(TARGET_CONCURRENCY, queue.length) }, worker)),
      new Promise<void>((resolve) => (timer = setTimeout(resolve, TARGET_BUDGET_MS))),
    ]);
    clearTimeout(timer);
    // A copy: workers still running must not change what this render already used.
    return new Map(targets);
  }

  /**
   * The `frontMatter:` section of `<wikiRoot>/.mdexplorer.yaml`. Read even in an
   * untrusted workspace: it only changes layout, and template output is escaped text.
   */
  private loadLocalDisplay(wikiRoot: vscode.Uri): Promise<unknown> {
    const key = wikiRoot.toString();
    let pending = this.localDisplay.get(key);
    if (!pending) {
      pending = this.readLocalDisplay(wikiRoot);
      this.localDisplay.set(key, pending);
    }
    return pending;
  }

  private async readLocalDisplay(wikiRoot: vscode.Uri): Promise<unknown> {
    const file = wikiRoot.with({ path: path.posix.join(wikiRoot.path, LOCAL_CONFIG_FILE) });
    let text: string;
    try {
      text = new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(file));
    } catch {
      return undefined;
    }
    try {
      const yaml = await import('js-yaml');
      const { YAML_OPTIONS } = await import('../renderer/frontMatter');
      const data = yaml.load(text, YAML_OPTIONS);
      if (data === undefined || data === null) {
        return undefined;
      }
      if (typeof data !== 'object' || Array.isArray(data)) {
        log.warn(`${file.path}: expected a mapping with a frontMatter: section`);
        return undefined;
      }
      log.info(`display settings loaded from ${file.path}`);
      return (data as Record<string, unknown>).frontMatter;
    } catch (error) {
      log.warn(`${file.path}: could not parse`, error);
      return undefined;
    }
  }

  private report(wikiRoot: vscode.Uri, warnings: string[]): void {
    for (const warning of warnings) {
      const key = `${wikiRoot.path}\n${warning}`;
      if (!this.reported.has(key)) {
        this.reported.add(key);
        log.warn(`front matter display (${wikiRoot.path}): ${warning}`);
      }
    }
  }

  async rootsFor(uri: vscode.Uri, declaredRoot?: unknown): Promise<DocRoots> {
    const docDir = uri.with({ path: path.posix.dirname(uri.path), query: '', fragment: '' });
    const wikiRoot = (await this.index.rootFor(uri, declaredRoot)) ?? docDir;
    try {
      const bundle = await this.findBundle(uri, wikiRoot);
      if (bundle) {
        return { wikiRoot, bundleRoot: bundle.root, okfVersion: bundle.version };
      }
    } catch (error) {
      log.warn(`could not look for an OKF bundle above ${uri.path}`, error);
    }
    return { wikiRoot, bundleRoot: wikiRoot };
  }

  /**
   * Walk up from the document to the wiki root (inclusive) looking for an `index.md`
   * that declares `okf_version`. The wiki root caps the walk because `root:` is the
   * author's statement of where the wiki ends; a bundle above it is someone else's.
   */
  private async findBundle(
    uri: vscode.Uri,
    wikiRoot: vscode.Uri
  ): Promise<{ root: vscode.Uri; version: string } | undefined> {
    const stopAt = wikiRoot.path;
    const underRoot = uri.path.startsWith(`${stopAt}/`);
    const folder = vscode.workspace.getWorkspaceFolder(uri)?.uri.path;
    let directory = path.posix.dirname(uri.path);
    for (let depth = 0; depth < 64; depth++) {
      const version = await this.bundleVersion(uri, directory);
      if (version !== null) {
        return { root: uri.with({ path: directory, query: '', fragment: '' }), version };
      }
      if ((underRoot && directory === stopAt) || (!underRoot && directory === folder)) {
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

  private async bundleVersion(uri: vscode.Uri, directory: string): Promise<string | null> {
    const cached = this.bundleDirs.get(directory);
    if (cached !== undefined) {
      return cached;
    }
    let version: string | null = null;
    const indexUri = uri.with({ path: path.posix.join(directory, 'index.md'), query: '', fragment: '' });
    if (this.index.has(indexUri)) {
      try {
        const { readFrontMatter } = await import('../renderer/frontMatter');
        const declared = readFrontMatter(await readDocumentText(indexUri))?.okf_version;
        if (typeof declared === 'string' || typeof declared === 'number') {
          version = String(declared);
        }
      } catch (error) {
        log.debug(`could not read ${indexUri.path}`, error);
      }
    }
    this.bundleDirs.set(directory, version);
    return version;
  }

  dispose(): void {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }
}
