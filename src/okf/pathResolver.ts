import * as path from 'path';

/**
 * Resolution of path-like values found in front matter.
 *
 * OKF front matter refers to other files in several shapes at once, and the real wikis
 * this viewer is built for mix all of them:
 *
 *  - `../sources/x.md`              relative to the document
 *  - `notes-2026-08-02.md`          a bare file name, also relative to the document
 *  - `runbooks/restart-db`          an OKF Concept ID, relative to the bundle root
 *  - `attachments/diagram.pdf`      relative to the wiki root (`root:` in front matter)
 *  - `/home/alice/shared/report.md` a filesystem path, which OKF would read as
 *                                   bundle-relative
 *
 * A value whose base is not spelled out is tried against every base in a fixed order,
 * and becomes a link only when exactly one candidate exists. Guessing between two real
 * files would silently point the reader at the wrong page; refusing costs only a link.
 *
 * Kept free of `vscode` so it can be tested directly. Paths are POSIX paths.
 */

export type RefBase = 'doc' | 'bundle' | 'wiki' | 'fs';

export type RefResult =
  | { kind: 'external'; href: string }
  | {
      kind: 'file';
      path: string;
      isMarkdown: boolean;
      fragment?: string;
      via: RefBase;
      /** A filesystem path: works on this machine, breaks when the wiki moves. */
      nonPortable?: boolean;
    }
  | { kind: 'ambiguous'; candidates: string[] }
  | { kind: 'missing'; tried: string[]; strong: boolean }
  /** Not shaped like a path at all; shown as text. */
  | { kind: 'text' };

export interface RefContext {
  /** Directory holding the document. */
  docDir: string;
  /** OKF bundle root: base of Concept IDs and of `/`-prefixed links. */
  bundleRoot: string;
  /** Wiki root (`root:` in front matter, a marker, or the workspace folder). */
  wikiRoot: string;
  /** Extensions beyond FILE_EXTENSIONS that mark a value as a file (lower case, with dot). */
  fileExtensions?: ReadonlySet<string>;
}

export const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mkdn']);

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const WINDOWS_DRIVE = /^[a-z]:[\\/]/i;
/** An extension with at least one letter, so `v0.2` or `1.5` are not file names. */
const EXTENSION = /\.[a-z0-9]*[a-z][a-z0-9]*$/i;

/**
 * Extensions that say "this is a file" with confidence. A bare value carrying anything
 * else — `db.prod`, `v2.final` — may be a file or may be a name, so failing to find it is
 * not reported. `knowledgeWalk.knownFileExtensions` adds to this list (see RefContext).
 */
export const FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  ...MARKDOWN_EXTENSIONS,
  '.txt', '.pdf', '.html', '.htm', '.csv', '.tsv', '.json', '.yaml', '.yml', '.toml', '.xml',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bib', '.tex', '.ipynb', '.py', '.r',
  '.sh', '.js', '.ts', '.c', '.h', '.cpp', '.rs', '.go', '.java', '.sql', '.log', '.docx',
  '.xlsx', '.pptx', '.zip', '.gz', '.tar',
]);

export function isMarkdownPath(p: string): boolean {
  return MARKDOWN_EXTENSIONS.has(path.posix.extname(p).toLowerCase());
}

function hasExtension(p: string): boolean {
  return EXTENSION.test(path.posix.basename(p));
}

/** Whether a front matter string is worth trying as a path at all. */
export function looksLikePath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return false;
  }
  if (SCHEME.test(trimmed) && !WINDOWS_DRIVE.test(trimmed)) {
    return true;
  }
  const [pathPart] = trimmed.split('#');
  return pathPart.includes('/') || hasExtension(pathPart);
}

function join(base: string, relative: string): string {
  return path.posix.normalize(path.posix.join(base, relative));
}

/** The candidate itself, and for an extensionless value the `.md` it most likely means. */
function variants(p: string): string[] {
  return hasExtension(p) ? [p] : [p, `${p}.md`];
}

export function resolveRef(
  value: string,
  ctx: RefContext,
  exists: (p: string) => boolean
): RefResult {
  const trimmed = value.trim();
  if (!looksLikePath(trimmed)) {
    return { kind: 'text' };
  }
  if (SCHEME.test(trimmed) && !WINDOWS_DRIVE.test(trimmed)) {
    return { kind: 'external', href: trimmed };
  }

  const hashIndex = trimmed.indexOf('#');
  const pathPart = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
  const fragment = hashIndex >= 0 ? trimmed.slice(hashIndex + 1) || undefined : undefined;
  const found = (p: string, via: RefBase, nonPortable?: boolean): RefResult => ({
    kind: 'file',
    path: p,
    isMarkdown: isMarkdownPath(p),
    fragment,
    via,
    ...(nonPortable ? { nonPortable } : {}),
  });

  // Spelled out relative to the document: there is only one place to look.
  if (pathPart.startsWith('./') || pathPart.startsWith('../')) {
    const tried = variants(join(ctx.docDir, pathPart));
    const hit = tried.find(exists);
    return hit ? found(hit, 'doc') : { kind: 'missing', tried, strong: true };
  }

  // OKF reads a leading slash as bundle-relative. A filesystem path is the other thing
  // it could mean; accept it only when the bundle has no such file, and flag it.
  if (pathPart.startsWith('/')) {
    const inBundle = variants(join(ctx.bundleRoot, pathPart.slice(1)));
    const bundleHit = inBundle.find(exists);
    if (bundleHit) {
      return found(bundleHit, 'bundle');
    }
    const absolute = variants(path.posix.normalize(pathPart));
    const absoluteHit = absolute.find(exists);
    if (absoluteHit) {
      return found(absoluteHit, 'fs', true);
    }
    return { kind: 'missing', tried: [...inBundle, ...absolute], strong: true };
  }

  const bases: [RefBase, string][] = [
    ['doc', ctx.docDir],
    ['bundle', ctx.bundleRoot],
    ['wiki', ctx.wikiRoot],
  ];
  const tried: string[] = [];
  const hits = new Map<string, RefBase>();
  for (const [via, base] of bases) {
    // Within one base the exact name wins over the `.md` guess.
    for (const candidate of variants(join(base, pathPart))) {
      if (tried.includes(candidate)) {
        break;
      }
      tried.push(candidate);
      if (exists(candidate)) {
        if (!hits.has(candidate)) {
          hits.set(candidate, via);
        }
        break;
      }
    }
  }
  if (hits.size === 1) {
    const [[hit, via]] = [...hits];
    return found(hit, via);
  }
  if (hits.size > 1) {
    return { kind: 'ambiguous', candidates: [...hits.keys()] };
  }
  // `my-agent/1.4` is shaped like a path but almost certainly is not one, and `db.prod`
  // may well be a name. Only a value that clearly names a file — a path
  // with an extension, or a known file extension — is reported as a broken reference.
  const extension = path.posix.extname(pathPart).toLowerCase();
  const strong =
    FILE_EXTENSIONS.has(extension) ||
    !!ctx.fileExtensions?.has(extension) ||
    (pathPart.includes('/') && hasExtension(pathPart));
  return { kind: 'missing', tried, strong };
}
