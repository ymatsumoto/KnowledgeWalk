/**
 * OKF v0.2 front matter, normalised for display.
 *
 * The spec fixes a small core — `type`, the recommended `title` / `description` /
 * `resource` / `tags`, provenance in `sources`, trust in `generated` / `verified`, and the
 * lifecycle keys `status` / `stale_after` — and lets producers add anything else. The core
 * gets typed fields here; everything else is kept, in the order it was written, as
 * `extensions`, because a consumer must preserve unknown keys rather than drop them.
 *
 * Kept free of `vscode` so it can be tested directly.
 */

export type ActorKind = 'human' | 'process' | 'producer' | 'other';

export interface Actor {
  raw: string;
  kind: ActorKind;
  /** `ymatsumoto` in `human:ymatsumoto`, `claude-code` in `claude-code/unknown`. */
  id: string;
  /** `unknown` in `claude-code/unknown`. */
  version?: string;
}

export interface Stamp {
  by: Actor;
  /** The timestamp exactly as written; see formatDate. */
  at?: string;
}

export interface SourceEntry {
  id?: string;
  resource?: string;
  title?: string;
  author?: string;
  lastModified?: string;
  /** Keys beyond the spec's, such as a wiki's own `relation:`. */
  extra: [string, unknown][];
  raw: Record<string, unknown>;
}

export type TrustTier = 'unverified' | 'machine' | 'human';

export interface OkfMeta {
  type?: string;
  title?: string;
  description?: string;
  resource?: string;
  tags: string[];
  /** `stable` when absent, as the spec says. */
  status: string;
  statusDeclared: boolean;
  staleAfter?: string;
  generated?: Stamp;
  verified: Stamp[];
  trust: TrustTier;
  sources: SourceEntry[];
  okfVersion?: string;
  /** Keys outside the OKF core, in source order. */
  extensions: [string, unknown][];
  raw: Record<string, unknown>;
}

/** Keys this module gives a meaning to; anything else is an extension. */
export const CORE_KEYS = new Set([
  'type',
  'title',
  'description',
  'resource',
  'tags',
  'status',
  'stale_after',
  'generated',
  'verified',
  'sources',
  'usage_window',
  'okf_version',
]);

function str(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object') {
    return undefined;
  }
  const text = String(value).trim();
  return text ? text : undefined;
}

export function parseActor(value: unknown): Actor | undefined {
  const raw = str(value);
  if (!raw) {
    return undefined;
  }
  const prefixed = /^(human|process):(.+)$/.exec(raw);
  if (prefixed) {
    return { raw, kind: prefixed[1] as 'human' | 'process', id: prefixed[2] };
  }
  const producer = /^([^/\s]+)\/([^/\s]+)$/.exec(raw);
  if (producer) {
    return { raw, kind: 'producer', id: producer[1], version: producer[2] };
  }
  return { raw, kind: 'other', id: raw };
}

function parseStamp(value: unknown): Stamp | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const by = parseActor(record.by);
  return by ? { by, at: str(record.at) } : undefined;
}

/** `verified` may be a list of stamps, or a single bare mapping meaning a list of one. */
function parseVerified(value: unknown): Stamp[] {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items.map(parseStamp).filter((stamp): stamp is Stamp => stamp !== undefined);
}

export function trustTier(verified: Stamp[]): TrustTier {
  if (verified.length === 0) {
    return 'unverified';
  }
  return verified.some((stamp) => stamp.by.kind === 'human') ? 'human' : 'machine';
}

const SOURCE_KEYS = new Set(['id', 'resource', 'title', 'author', 'last_modified']);

function parseSources(value: unknown): SourceEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item): SourceEntry[] => {
    if (typeof item === 'string') {
      // Not the spec's shape, but a list of bare resources is a common shorthand.
      return [{ resource: item, extra: [], raw: { resource: item } }];
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }
    const raw = item as Record<string, unknown>;
    return [
      {
        id: str(raw.id),
        resource: str(raw.resource),
        title: str(raw.title),
        author: str(raw.author),
        lastModified: str(raw.last_modified),
        extra: Object.entries(raw).filter(([key]) => !SOURCE_KEYS.has(key)),
        raw,
      },
    ];
  });
}

function parseTags(value: unknown): string[] {
  const items = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return items.map(str).filter((tag): tag is string => tag !== undefined);
}

export function parseOkf(raw: Record<string, unknown>): OkfMeta {
  const verified = parseVerified(raw.verified);
  const status = str(raw.status);
  return {
    type: str(raw.type),
    title: str(raw.title),
    description: str(raw.description),
    resource: str(raw.resource),
    tags: parseTags(raw.tags),
    status: status ?? 'stable',
    statusDeclared: status !== undefined,
    staleAfter: str(raw.stale_after),
    generated: parseStamp(raw.generated),
    verified,
    trust: trustTier(verified),
    sources: parseSources(raw.sources),
    okfVersion: str(raw.okf_version),
    extensions: Object.entries(raw).filter(([key]) => !CORE_KEYS.has(key)),
    raw,
  };
}

/**
 * Milliseconds since the epoch for an ISO 8601 date or datetime, or undefined when the
 * value is not one. A bare date is read as midnight UTC.
 */
export function parseTime(value: string | undefined): number | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) {
    return undefined;
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : time;
}

/** Past `stale_after`, per OKF §5.5. Undefined when there is no usable `stale_after`. */
export function isStale(meta: OkfMeta, now: number): boolean | undefined {
  const limit = parseTime(meta.staleAfter);
  return limit === undefined ? undefined : now >= limit;
}

/** Sources that changed after this page last did, by `last_modified` vs `generated.at`. */
export function sourcesNewerThanPage(meta: OkfMeta): SourceEntry[] {
  const generated = parseTime(meta.generated?.at);
  if (generated === undefined) {
    return [];
  }
  return meta.sources.filter((source) => {
    const modified = parseTime(source.lastModified);
    return modified !== undefined && modified > generated;
  });
}

/**
 * The calendar date as written, without converting to UTC or to the viewer's zone: a
 * page generated at `2026-08-07T08:00:00+09:00` was generated on the 7th where it was
 * written, and converting would show the 6th.
 */
export function formatDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return /^(\d{4}-\d{2}-\d{2})/.exec(value)?.[1] ?? value;
}
