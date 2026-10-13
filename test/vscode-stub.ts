/**
 * The slice of the `vscode` module the pure modules under test actually touch.
 * esbuild aliases `vscode` to this file when building the test bundles.
 */

const URI_PATTERN = /^(([^:/?#]+?):)?(\/\/([^/?#]*))?([^?#]*)(\?([^#]*))?(#(.*))?/;

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export class Uri {
  private constructor(
    readonly scheme: string,
    readonly authority: string,
    readonly path: string,
    readonly query: string,
    readonly fragment: string
  ) {}

  static parse(value: string): Uri {
    const match = URI_PATTERN.exec(value);
    if (!match) {
      return new Uri('', '', value, '', '');
    }
    return new Uri(
      (match[2] ?? '').toLowerCase(),
      decode(match[4] ?? ''),
      decode(match[5] ?? ''),
      decode(match[7] ?? ''),
      decode(match[9] ?? '')
    );
  }

  static file(fsPath: string): Uri {
    return new Uri('file', '', fsPath, '', '');
  }

  static joinPath(base: Uri, ...segments: string[]): Uri {
    const joined = [base.path.replace(/\/$/, ''), ...segments].join('/');
    return base.with({ path: joined });
  }

  with(change: {
    scheme?: string;
    authority?: string;
    path?: string;
    query?: string;
    fragment?: string;
  }): Uri {
    return new Uri(
      change.scheme ?? this.scheme,
      change.authority ?? this.authority,
      change.path ?? this.path,
      change.query ?? this.query,
      change.fragment ?? this.fragment
    );
  }

  get fsPath(): string {
    return this.path;
  }

  toString(): string {
    let result = this.scheme ? `${this.scheme}:` : '';
    if (this.authority || this.scheme === 'file') {
      result += `//${this.authority}`;
    }
    result += encodeURI(this.path).replace(/#/g, '%23');
    if (this.query) {
      result += `?${encodeURIComponent(this.query)}`;
    }
    if (this.fragment) {
      result += `#${encodeURIComponent(this.fragment)}`;
    }
    return result;
  }
}

/**
 * Structurally just `{ dispose(): void }`, like the real one — a private field here would
 * make the type nominal and nothing in `src` would satisfy it.
 */
export class Disposable {
  constructor(callOnDispose: () => unknown) {
    this.dispose = () => {
      callOnDispose();
    };
  }

  dispose(): void {
    /* replaced in the constructor */
  }

  static from(...items: { dispose(): unknown }[]): Disposable {
    return new Disposable(() => items.forEach((item) => item.dispose()));
  }
}

export interface LogOutputChannel {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  show(preserveFocus?: boolean): void;
  dispose(): void;
}

export interface Memento {
  get<T>(key: string, fallback: T): T;
  update(key: string, value: unknown): Promise<void>;
}

export interface ExtensionContext {
  subscriptions: { dispose(): unknown }[];
  workspaceState: Memento;
  extensionUri: Uri;
}

const noop = () => undefined;

export const window = {
  createOutputChannel(_name: string, _options?: { log: boolean }): LogOutputChannel {
    return { info: noop, warn: noop, error: noop, debug: noop, show: noop, dispose: noop };
  },
};

/** Only the two members the renderer touches. */
export interface Webview {
  asWebviewUri(uri: Uri): Uri;
  readonly cspSource: string;
}

export interface WorkspaceFolder {
  uri: Uri;
  name: string;
  index: number;
}

let folders: WorkspaceFolder[] = [];

/** Test helper: define the workspace folders the code under test should see. */
export function __setWorkspaceFolders(paths: string[]): void {
  folders = paths.map((p, index) => ({ uri: Uri.file(p), name: p, index }));
}

let files: Uri[] = [];

/** Test helper: define the workspace files the wiki link index should find. */
export function __setFiles(paths: string[]): void {
  files = paths.map((p) => Uri.file(p));
}

let statPaths = new Set<string>();

/**
 * Test helper: paths `workspace.fs.stat` should report as existing. Everything else is
 * missing, so root-marker lookups stay predictable.
 */
export function __setStatPaths(paths: string[]): void {
  statPaths = new Set(paths);
}

let settings: Record<string, unknown> = {};

/** Test helper: define the settings `readConfig` should see. */
export function __setConfiguration(values: Record<string, unknown>): void {
  settings = values;
}

export const workspace = {
  get workspaceFolders(): WorkspaceFolder[] | undefined {
    return folders.length > 0 ? folders : undefined;
  },
  getWorkspaceFolder(uri: Uri): WorkspaceFolder | undefined {
    return folders.find((folder) => uri.path.startsWith(`${folder.uri.path}/`));
  },
  async findFiles(_include: string, _exclude?: string, _max?: number): Promise<Uri[]> {
    return files;
  },
  createFileSystemWatcher(_glob: string) {
    const subscribe = (_listener: (uri: Uri) => void) => ({ dispose() {} });
    return {
      onDidCreate: subscribe,
      onDidDelete: subscribe,
      onDidChange: subscribe,
      dispose() {},
    };
  },
  onDidChangeWorkspaceFolders(_listener: () => void) {
    return { dispose() {} };
  },
  textDocuments: [] as { uri: Uri; getText(): string }[],
  fs: {
    async stat(uri: Uri): Promise<{ type: number }> {
      if (statPaths.has(uri.path)) {
        return { type: 1 };
      }
      throw new Error('not found');
    },
    /** Reads the real file, so tests can point at the samples on disk. */
    async readFile(uri: Uri): Promise<Uint8Array> {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('node:fs').readFileSync(uri.path);
    },
  },
  getConfiguration(_section?: string | null, _scope?: unknown) {
    return {
      get<T>(key: string, fallback: T): T {
        return key in settings ? (settings[key] as T) : fallback;
      },
    };
  },
};
