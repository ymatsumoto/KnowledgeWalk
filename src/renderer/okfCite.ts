import * as vscode from 'vscode';
import type MarkdownIt from 'markdown-it';
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs';
import { escapeHtml } from './highlight';
import { sourceAnchor } from './card';
import type { SourceEntry } from '../okf/model';

/**
 * OKF per-claim attribution: `[^id]` whose label is a `sources[].id` (OKF §5.1).
 *
 * Unlike an ordinary footnote the body carries no `[^id]: …` definition — the source
 * entry in front matter is the definition — so markdown-it-footnote leaves the text as
 * typed. This rule runs after it: a label the body does define stays an ordinary
 * footnote, one naming a source becomes a numbered citation linking to the card's source
 * list, and in a document that has sources at all, one naming neither is marked.
 */

export interface CiteEnv {
  /** `sources[].id` -> entry, for the document being rendered. */
  okfSources?: Map<string, SourceEntry>;
  /** Citation numbers in order of first use. */
  okfCiteNumbers?: Map<string, number>;
  footnotes?: { refs?: Record<string, number> };
  okfWarn?(message: string): void;
}

function okfCite(state: StateInline, silent: boolean): boolean {
  const env = state.env as CiteEnv;
  const sources = env.okfSources;
  if (!sources) {
    return false;
  }
  const start = state.pos;
  const max = state.posMax;
  if (start + 3 > max || state.src.charCodeAt(start) !== 0x5b || state.src.charCodeAt(start + 1) !== 0x5e) {
    return false;
  }
  let pos = start + 2;
  for (; pos < max; pos++) {
    const code = state.src.charCodeAt(pos);
    if (code === 0x20 || code === 0x0a) {
      return false;
    }
    if (code === 0x5d) {
      break;
    }
  }
  if (pos === start + 2 || pos >= max) {
    return false;
  }
  const label = state.src.slice(start + 2, pos);
  // Defined in the body: markdown-it-footnote has already claimed it.
  if (env.footnotes?.refs?.[`:${label}`] !== undefined) {
    return false;
  }
  if (!silent) {
    const source = sources.get(label);
    if (!source) {
      env.okfWarn?.(`[^${label}] names no source in front matter and no footnote in the body`);
    }
    const token = state.push(source ? 'okf_cite' : 'okf_cite_missing', '', 0);
    token.meta = { id: label };
    if (source) {
      const numbers = (env.okfCiteNumbers ??= new Map());
      if (!numbers.has(label)) {
        numbers.set(label, numbers.size + 1);
      }
      token.meta.n = numbers.get(label);
      token.meta.source = source;
    }
  }
  state.pos = pos + 1;
  return true;
}

export function okfCitePlugin(md: MarkdownIt): void {
  md.inline.ruler.after('footnote_ref', 'okf_cite', okfCite);

  md.renderer.rules.okf_cite = (tokens, idx) => {
    const { id, n, source } = tokens[idx].meta as { id: string; n: number; source: SourceEntry };
    const tip = [source.title, source.resource].filter(Boolean).join(' — ') || id;
    return `<sup class="mdx-cite"><a href="#${escapeHtml(sourceAnchor(id))}" data-mdx-cite="${escapeHtml(id)}" title="${escapeHtml(tip)}">[${n}]</a></sup>`;
  };

  md.renderer.rules.okf_cite_missing = (tokens, idx) => {
    const { id } = tokens[idx].meta as { id: string };
    return `<sup class="mdx-cite mdx-cite-missing" title="${escapeHtml(vscode.l10n.t('No source with id "{0}" in front matter', id))}">[${escapeHtml(id)}?]</sup>`;
  };
}
