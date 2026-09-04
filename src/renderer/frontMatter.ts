import * as yaml from 'js-yaml';
import { escapeHtml } from './highlight';

export type FrontMatterMode = 'hide' | 'table' | 'source';

const URL_PATTERN = /^https?:\/\/\S+$/i;
const FRONT_MATTER_PATTERN = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Read the document's front matter without running the whole Markdown pipeline.
 *
 * Needed before rendering, because a `root:` key there decides how `[[wiki links]]`
 * in the body are resolved.
 */
export function readFrontMatter(text: string): Record<string, unknown> | undefined {
  const match = FRONT_MATTER_PATTERN.exec(text);
  if (!match) {
    return undefined;
  }
  try {
    const data = yaml.load(match[1]);
    return data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function asText(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value);
}

/** A scalar, rendered as a link when the whole value is one. */
function formatScalar(value: unknown): string {
  const text = asText(value);
  if (typeof value === 'string' && URL_PATTERN.test(value)) {
    // data-mdx-kind is what the preview's click handler looks for; without a
    // data-mdx-link these never take part in the back/forward scroll bookkeeping.
    return `<a data-mdx-kind="external" data-mdx-href="${escapeHtml(value)}" href="${escapeHtml(
      value
    )}">${escapeHtml(text)}</a>`;
  }
  return escapeHtml(text);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '<span class="mdx-fm-empty">—</span>';
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '<span class="mdx-fm-empty">—</span>';
    }
    return value
      .map((item) =>
        item !== null && typeof item === 'object' && !(item instanceof Date)
          ? `<span class="mdx-fm-chip">${escapeHtml(JSON.stringify(item))}</span>`
          : `<span class="mdx-fm-chip">${formatScalar(item)}</span>`
      )
      .join('');
  }
  if (value instanceof Date) {
    return escapeHtml(asText(value));
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return '<span class="mdx-fm-empty">—</span>';
    }
    return `<ul class="mdx-fm-nested">${entries
      .map(([key, nested]) => `<li><b>${escapeHtml(key)}</b> ${formatValue(nested)}</li>`)
      .join('')}</ul>`;
  }
  return formatScalar(value);
}

function sourceBlock(raw: string): string {
  return `<pre class="mdx-frontmatter-source"><code>${escapeHtml(raw)}</code></pre>\n`;
}

/**
 * Render a document's YAML front matter.
 *
 * Left to markdown-it, `---` delimited front matter parses as a setext heading followed
 * by a paragraph, which is why it shows up as a wall of bold text at the top of the page.
 * The default is to drop it; `table` turns it into a compact metadata card instead.
 */
export function renderFrontMatter(raw: string, mode: FrontMatterMode): string {
  if (mode === 'hide') {
    return '';
  }
  if (mode === 'source') {
    return sourceBlock(raw);
  }

  let data: unknown;
  try {
    data = yaml.load(raw);
  } catch {
    // Malformed YAML is still worth showing, just not as a table.
    return sourceBlock(raw);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return data === null || data === undefined ? '' : sourceBlock(raw);
  }

  const rows = Object.entries(data as Record<string, unknown>).map(
    ([key, value]) =>
      `<div class="mdx-fm-row"><dt>${escapeHtml(key)}</dt><dd>${formatValue(value)}</dd></div>`
  );
  if (rows.length === 0) {
    return '';
  }
  return `<dl class="mdx-frontmatter">${rows.join('')}</dl>\n`;
}
