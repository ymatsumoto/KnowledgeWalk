import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import { escapeHtml } from './highlight';
import { renderCard, wantsCard, type CardEnv } from './card';

export type FrontMatterMode = 'auto' | 'table' | 'hide' | 'source';

/**
 * YAML 1.2 core schema: no implicit timestamps. js-yaml's default schema turns
 * `2026-08-07T10:00:00+09:00` into a Date in UTC, which loses the date as it was written
 * (it becomes the 6th) — dates are kept as the strings their authors wrote.
 */
export const YAML_OPTIONS = { schema: yaml.CORE_SCHEMA };

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
    const data = yaml.load(match[1], YAML_OPTIONS);
    return data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function sourceBlock(raw: string, note?: string): string {
  const caption = note ? `<div class="mdx-frontmatter-note">${escapeHtml(note)}</div>` : '';
  return `<pre class="mdx-frontmatter-source" data-line="0">${caption}<code>${escapeHtml(raw)}</code></pre>\n`;
}

/**
 * Render a document's YAML front matter.
 *
 * Left to markdown-it, `---` delimited front matter parses as a setext heading followed
 * by a paragraph, which is why it shows up as a wall of bold text at the top of the page.
 *
 *  - `auto`    a metadata card when the front matter has a `type`, nothing otherwise
 *  - `table`   always the card
 *  - `hide`    nothing
 *  - `source`  the YAML as written
 */
export function renderFrontMatter(raw: string, mode: FrontMatterMode, env: CardEnv): string {
  if (mode === 'hide') {
    return '';
  }
  if (mode === 'source') {
    return sourceBlock(raw);
  }

  let data: unknown;
  try {
    data = yaml.load(raw, YAML_OPTIONS);
  } catch {
    // Malformed YAML is still worth showing, just not as a card.
    return sourceBlock(raw, vscode.l10n.t('This front matter is not valid YAML.'));
  }
  if (data === null || data === undefined) {
    return '';
  }
  if (typeof data !== 'object' || Array.isArray(data)) {
    return sourceBlock(raw);
  }
  const record = data as Record<string, unknown>;
  if (mode === 'auto' && !wantsCard(record)) {
    return '';
  }
  return renderCard(record, env);
}
