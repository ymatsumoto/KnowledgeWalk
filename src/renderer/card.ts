import * as vscode from 'vscode';
import * as path from 'path';
import { escapeHtml } from './highlight';
import {
  DEFAULT_DISPLAY,
  fieldSpec,
  fillTemplate,
  PLACED_KEYS,
  type DisplayConfig,
  type FieldSpec,
} from '../okf/displayConfig';
import {
  formatDate,
  isStale,
  parseOkf,
  parseTime,
  sourcesNewerThanPage,
  type OkfMeta,
  type SourceEntry,
  type Stamp,
} from '../okf/model';
import { looksLikePath, resolveRef, type RefContext, type RefResult } from '../okf/pathResolver';
import type { TargetMeta } from '../okf/metaCache';
import type { PreparedDocument } from '../okf/service';

/**
 * The metadata card shown above a document with front matter.
 *
 * Layout, top to bottom: lifecycle banners, a header line of badges, the title when the
 * body does not already say it, the description as a lead, the sources, and everything
 * else folded under "Details". Which key goes where, and how each value is drawn, comes
 * from the DisplayConfig; a key nobody configured is drawn by the `auto` rule.
 *
 * Every value is escaped. Links carry the same data-mdx-* attributes as links in the
 * body, so clicking one navigates in the tab, joins the history, and ctrl-click opens a
 * background tab.
 */

export interface CardEnv {
  docUri: vscode.Uri;
  prepared?: PreparedDocument;
  /** The first level-one heading of the body, to avoid repeating it as the title. */
  firstH1?: string;
  nextLinkId(): number;
  warn(message: string): void;
  now: number;
}

/** Keys whose badge reads well without the key name in front of it. */
const UNLABELLED_BADGES = new Set(['type', 'status']);

function trustLabel(tier: 'unverified' | 'machine' | 'human'): string {
  switch (tier) {
    case 'human':
      return vscode.l10n.t('human-reviewed');
    case 'machine':
      return vscode.l10n.t('machine-checked');
    default:
      return vscode.l10n.t('unverified');
  }
}

class Card {
  private readonly display: DisplayConfig;
  private readonly refContext: RefContext;
  private readonly exists: (p: string) => boolean;
  private readonly targets: Map<string, TargetMeta>;

  constructor(
    private readonly meta: OkfMeta,
    private readonly env: CardEnv
  ) {
    const docDir = path.posix.dirname(env.docUri.path);
    this.display = env.prepared?.display ?? DEFAULT_DISPLAY;
    this.refContext = env.prepared?.refContext ?? { docDir, bundleRoot: docDir, wikiRoot: docDir };
    this.exists = env.prepared?.exists ?? (() => false);
    this.targets = env.prepared?.targets ?? new Map();
  }

  render(): string {
    const parts = [
      this.banners(),
      this.header(),
      this.title(),
      this.lead(),
      this.sources(),
      this.details(),
    ].filter(Boolean);
    if (parts.length === 0) {
      return '';
    }
    const classes = ['mdx-card'];
    if (this.meta.status === 'deprecated') {
      classes.push('mdx-card-deprecated');
    }
    return `<section class="${classes.join(' ')}" data-line="0">${parts.join('')}</section>\n`;
  }

  // ------------------------------------------------------------- sections

  private banners(): string {
    const banners: string[] = [];
    for (const [key, value] of [
      ['stale_after', this.meta.staleAfter],
      ['generated.at', this.meta.generated?.at],
    ] as const) {
      if (value && parseTime(value) === undefined) {
        this.env.warn(`${key} "${value}" is not an ISO 8601 date; it is shown as written`);
      }
    }
    if (this.meta.status === 'deprecated' && this.visible('status')) {
      banners.push(
        this.banner(
          'gray',
          vscode.l10n.t('Deprecated'),
          vscode.l10n.t('Kept so links and history still work; no longer current.')
        )
      );
    }
    if (isStale(this.meta, this.env.now)) {
      banners.push(
        this.banner(
          'orange',
          vscode.l10n.t('Possibly out of date'),
          vscode.l10n.t('Marked stale after {0}.', formatDate(this.meta.staleAfter) ?? '')
        )
      );
    }
    const newer = sourcesNewerThanPage(this.meta);
    if (newer.length > 0) {
      const names = newer.map((source) => source.id ?? source.title ?? source.resource ?? '?');
      banners.push(
        this.banner(
          'blue',
          vscode.l10n.t('Sources changed since'),
          newer.length === 1
            ? vscode.l10n.t('{0} was modified after this page was generated ({1}).', names[0], formatDate(this.meta.generated?.at) ?? '')
            : vscode.l10n.t('{0} were modified after this page was generated ({1}).', names.join(', '), formatDate(this.meta.generated?.at) ?? '')
        )
      );
    }
    return banners.join('');
  }

  private banner(color: string, heading: string, text: string): string {
    return `<div class="mdx-card-banner mdx-c-${color}"><strong>${escapeHtml(heading)}</strong> ${escapeHtml(text)}</div>`;
  }

  private header(): string {
    const items: string[] = [];
    for (const key of this.display.header) {
      if (key === 'trust') {
        items.push(this.trustBadge());
        continue;
      }
      if (!(key in this.meta.raw) || !this.visible(key) || key === this.display.lead) {
        continue;
      }
      items.push(this.inline(key, this.meta.raw[key], fieldSpec(this.display, key)));
    }
    const html = items.filter(Boolean).join('');
    return html ? `<div class="mdx-card-header">${html}</div>` : '';
  }

  private title(): string {
    const title = this.meta.title;
    if (!title || !this.visible('title')) {
      return '';
    }
    const normalise = (s: string) => s.replace(/\s+/g, ' ').trim();
    if (this.display.hideTitleWhenSameAsH1 && this.env.firstH1 && normalise(this.env.firstH1) === normalise(title)) {
      return '';
    }
    // With no heading of its own the title is the page's name; otherwise it is the
    // longer form the front matter gives, such as one with a date attached.
    const cls = this.env.firstH1 ? 'mdx-card-subtitle' : 'mdx-card-title';
    return `<div class="${cls}">${escapeHtml(title)}</div>`;
  }

  private lead(): string {
    const key = this.display.lead;
    const value = this.meta.raw[key];
    if (value === undefined || value === null || value === '' || !this.visible(key)) {
      return '';
    }
    return `<p class="mdx-card-lead">${this.block(key, value, fieldSpec(this.display, key))}</p>`;
  }

  private sources(): string {
    if (!this.meta.sources.length || fieldSpec(this.display, 'sources').as !== 'sources') {
      return '';
    }
    const newer = new Set(sourcesNewerThanPage(this.meta));
    const items = this.meta.sources.map((source) => this.source(source, newer.has(source)));
    return `<div class="mdx-card-sources"><div class="mdx-card-section">${escapeHtml(vscode.l10n.t('Sources'))}</div><ol>${items.join('')}</ol></div>`;
  }

  private source(source: SourceEntry, changed: boolean): string {
    const id = source.id ? ` id="${escapeHtml(sourceAnchor(source.id))}"` : '';
    const label = source.id ? `<span class="mdx-src-id">${escapeHtml(source.id)}</span>` : '';
    let main: string;
    if (source.resource) {
      main = this.ref(source.resource, { as: 'link', label: 'title' }, source.title);
    } else {
      main = escapeHtml(source.title ?? '—');
    }
    const extra = source.extra
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `<span class="mdx-src-extra">${escapeHtml(key)}: ${this.block(key, value, { as: 'auto' })}</span>`);
    if (source.author) {
      extra.unshift(`<span class="mdx-src-extra">${escapeHtml(source.author)}</span>`);
    }
    if (source.lastModified) {
      extra.push(
        `<span class="mdx-src-extra${changed ? ' mdx-src-changed' : ''}">${escapeHtml(vscode.l10n.t('modified {0}', formatDate(source.lastModified) ?? ''))}</span>`
      );
    }
    return `<li${id}>${label}${main}${extra.join('')}</li>`;
  }

  private details(): string {
    if (this.display.details === 'hidden') {
      return '';
    }
    const placed = new Set([...this.display.header, this.display.lead, ...PLACED_KEYS]);
    const rows: string[] = [];
    for (const [key, value] of Object.entries(this.meta.raw)) {
      if (placed.has(key)) {
        continue;
      }
      const spec = fieldSpec(this.display, key);
      if (spec.as === 'hidden' || (spec.as === 'sources' && key === 'sources' && this.meta.sources.length)) {
        continue;
      }
      rows.push(`<div class="mdx-fm-row"><dt>${escapeHtml(key)}</dt><dd>${this.block(key, value, spec)}</dd></div>`);
    }
    if (!rows.length) {
      return '';
    }
    const open = this.display.details === 'expanded' ? ' open' : '';
    return `<details class="mdx-card-details"${open}><summary>${escapeHtml(vscode.l10n.t('Details'))} <span class="mdx-card-count">${rows.length}</span></summary><dl class="mdx-frontmatter">${rows.join('')}</dl></details>`;
  }

  // ------------------------------------------------------------- values

  private visible(key: string): boolean {
    return fieldSpec(this.display, key).as !== 'hidden';
  }

  private trustBadge(): string {
    // Only meaningful for generated content, or content someone has vouched for.
    if (!this.meta.generated && this.meta.verified.length === 0) {
      return '';
    }
    const tier = this.meta.trust;
    const color = tier === 'human' ? 'green' : tier === 'machine' ? 'blue' : 'outline';
    const detail = this.meta.verified.length
      ? vscode.l10n.t('Verified by {0}', this.meta.verified.map(stampText).join('; '))
      : vscode.l10n.t('No one has verified this page.');
    return `<span class="mdx-badge mdx-c-${color}" title="${escapeHtml(detail)}">${escapeHtml(trustLabel(tier))}</span>`;
  }

  /** A value on the header line: compact, one line. */
  private inline(key: string, value: unknown, spec: FieldSpec): string {
    if (value === undefined || value === null || value === '') {
      return '';
    }
    switch (spec.as) {
      case 'badge':
      case 'auto':
      case 'text':
        if (spec.as === 'auto' && (typeof value === 'object' || this.isRef(value))) {
          return `<span class="mdx-card-field"><span class="mdx-badge-key">${escapeHtml(key)}</span>${this.block(key, value, spec)}</span>`;
        }
        return this.badges(key, value, spec, true);
      default:
        return `<span class="mdx-card-field" title="${escapeHtml(key)}">${this.block(key, value, spec)}</span>`;
    }
  }

  /** `withKey` prefixes the key name, for the header line where nothing else names it. */
  private badges(key: string, value: unknown, spec: FieldSpec, withKey = false): string {
    const values = (Array.isArray(value) ? value : [value]).filter(
      (item) => item !== null && item !== undefined && typeof item !== 'object'
    );
    return values
      .map(String)
      .filter((text) => !spec.hideValues?.includes(text))
      .map((text) => {
        const color = spec.colors?.[text] ?? (spec.as === 'badge' ? 'default' : 'plain');
        const keyLabel = !withKey || UNLABELLED_BADGES.has(key)
          ? ''
          : `<span class="mdx-badge-key">${escapeHtml(key)}</span>`;
        return `<span class="mdx-badge mdx-c-${color}" title="${escapeHtml(key)}">${keyLabel}${escapeHtml(text)}</span>`;
      })
      .join('');
  }

  /** A value under Details, or as the lead: may span lines. */
  private block(key: string, value: unknown, spec: FieldSpec): string {
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) {
      return '<span class="mdx-fm-empty">—</span>';
    }
    switch (spec.as) {
      case 'text':
        return escapeHtml(typeof value === 'object' ? JSON.stringify(value) : String(value));
      case 'badge':
        return this.badges(key, value, spec);
      case 'chips':
        return this.chips(Array.isArray(value) ? value : [value], spec);
      case 'date':
        return typeof value === 'string' ? escapeHtml(formatDate(value) ?? value) : this.auto(value, spec);
      case 'link':
      case 'links':
        if (typeof value === 'string') {
          return this.ref(value, spec);
        }
        if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
          return value.map((item) => this.ref(item as string, spec)).join('<span class="mdx-sep">, </span>');
        }
        return this.auto(value, spec);
      case 'table':
        return Array.isArray(value) ? this.table(value) : this.auto(value, spec);
      case 'template':
        return escapeHtml(fillTemplate(spec.template ?? '{value}', value, { date: (v) => formatDate(v) ?? v }));
      default:
        return this.auto(value, spec);
    }
  }

  private auto(value: unknown, spec: FieldSpec): string {
    if (typeof value === 'string') {
      return this.ref(value, spec);
    }
    if (Array.isArray(value)) {
      if (value.some((item) => item !== null && typeof item === 'object' && !Array.isArray(item))) {
        return this.table(value);
      }
      return this.chips(value, spec);
    }
    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      if (!entries.length) {
        return '<span class="mdx-fm-empty">—</span>';
      }
      return `<dl class="mdx-fm-nested">${entries
        .map(([key, nested]) => `<div><dt>${escapeHtml(key)}</dt><dd>${this.block(key, nested, { as: 'auto' })}</dd></div>`)
        .join('')}</dl>`;
    }
    return escapeHtml(String(value));
  }

  private chips(values: unknown[], spec: FieldSpec): string {
    return values
      .filter((item) => item !== null && item !== undefined)
      .map((item) => {
        const inner =
          typeof item === 'string' ? this.ref(item, spec) : escapeHtml(typeof item === 'object' ? JSON.stringify(item) : String(item));
        return `<span class="mdx-fm-chip">${inner}</span>`;
      })
      .join('');
  }

  private table(rows: unknown[]): string {
    const records = rows.map((row) =>
      row && typeof row === 'object' && !Array.isArray(row) ? (row as Record<string, unknown>) : { value: row }
    );
    const columns: string[] = [];
    for (const record of records) {
      for (const key of Object.keys(record)) {
        if (!columns.includes(key)) {
          columns.push(key);
        }
      }
    }
    const head = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('');
    const body = records
      .map(
        (record) =>
          `<tr>${columns
            .map((column) => `<td>${column in record ? this.block(column, record[column], { as: 'auto' }) : ''}</td>`)
            .join('')}</tr>`
      )
      .join('');
    return `<div class="mdx-fm-table"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  private isRef(value: unknown): boolean {
    return typeof value === 'string' && looksLikePath(value);
  }

  /** A string that may be a reference: a link when it resolves to exactly one thing. */
  private ref(value: string, spec: FieldSpec, label?: string): string {
    const result: RefResult = this.isRef(value) ? resolveRef(value, this.refContext, this.exists) : { kind: 'text' };
    switch (result.kind) {
      case 'external':
        return `<a data-mdx-link="${this.env.nextLinkId()}" data-mdx-kind="external" data-mdx-href="${escapeHtml(result.href)}" href="${escapeHtml(result.href)}" title="${escapeHtml(result.href)}">${escapeHtml(label ?? value)}</a>`;
      case 'file': {
        const target = this.env.docUri.with({ path: result.path, query: '', fragment: '' });
        const meta = result.isMarkdown ? this.targets.get(result.path) : undefined;
        const text = label ?? (spec.label !== 'path' && meta?.title ? meta.title : value);
        const attrs = [
          `data-mdx-link="${this.env.nextLinkId()}"`,
          `data-mdx-kind="${result.isMarkdown ? 'markdown' : 'file'}"`,
          `data-mdx-target="${escapeHtml(target.toString())}"`,
          result.fragment ? `data-mdx-fragment="${escapeHtml(result.fragment)}"` : '',
          `href="${escapeHtml(value)}"`,
          `title="${escapeHtml(result.nonPortable ? vscode.l10n.t('{0} — a machine-specific path', target.fsPath) : target.fsPath)}"`,
        ].filter(Boolean);
        if (result.nonPortable) {
          this.env.warn(`"${value}" is a filesystem path; it will break when the wiki moves`);
          attrs.push('class="mdx-ref-nonportable"');
        }
        return `<a ${attrs.join(' ')}>${escapeHtml(text)}</a>`;
      }
      case 'ambiguous':
        this.env.warn(`"${value}" matches more than one file: ${result.candidates.join(', ')}`);
        return `<span class="mdx-ref-ambiguous" title="${escapeHtml(vscode.l10n.t('Ambiguous: {0}', result.candidates.join(' | ')))}">${escapeHtml(label ?? value)}</span>`;
      case 'missing': {
        const directory = result.tried.find((p) => this.env.prepared?.isDirectory(p));
        if (directory) {
          return `<span class="mdx-ref-directory" title="${escapeHtml(vscode.l10n.t('Directory: {0}', directory))}">${escapeHtml(label ?? value)}</span>`;
        }
        if (result.strong) {
          this.env.warn(`"${value}" does not resolve to a file`);
          return `<span class="mdx-ref-missing" title="${escapeHtml(vscode.l10n.t('Not found: {0}', result.tried.join(' | ')))}">${escapeHtml(label ?? value)}</span>`;
        }
        return escapeHtml(label ?? value);
      }
      default:
        return escapeHtml(label ?? value);
    }
  }
}

function stampText(stamp: Stamp): string {
  return stamp.at ? `${stamp.by.raw} (${formatDate(stamp.at)})` : stamp.by.raw;
}

/** The element id a source entry is given, which `[^id]` citations link to. */
export function sourceAnchor(id: string): string {
  return `mdx-src-${id}`;
}

/**
 * Whether `auto` shows a card for this front matter: when it has a `type`, which every
 * OKF concept must, and which generated wikis generally carry.
 */
export function wantsCard(data: Record<string, unknown>): boolean {
  return typeof data.type === 'string' && data.type.trim() !== '';
}

export function renderCard(data: Record<string, unknown>, env: CardEnv): string {
  return new Card(parseOkf(data), env).render();
}
