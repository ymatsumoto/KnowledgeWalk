import type MarkdownIt from 'markdown-it';
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs';
import type { WikiLinkFallback, WikiLinkIndex } from '../wikiIndex';
import { escapeHtml } from './highlight';

const BRACKET = 0x5b; /* [ */
const BANG = 0x21; /* ! */

export interface WikiLinkEnv {
  docUri: import('vscode').Uri;
  wikiIndex: WikiLinkIndex;
  wikiRoot?: import('vscode').Uri;
}

interface Parsed {
  target: string;
  fragment: string;
  label: string;
  embed: boolean;
  end: number;
}

/** `[[target]]`, `[[target|label]]`, `[[target#heading]]`, `![[image.png]]` */
function parse(src: string, start: number): Parsed | undefined {
  let pos = start;
  const embed = src.charCodeAt(pos) === BANG;
  if (embed) {
    pos += 1;
  }
  if (src.charCodeAt(pos) !== BRACKET || src.charCodeAt(pos + 1) !== BRACKET) {
    return undefined;
  }

  const contentStart = pos + 2;
  const close = src.indexOf(']]', contentStart);
  if (close < 0) {
    return undefined;
  }
  const inner = src.slice(contentStart, close);
  // Nested brackets or a line break mean this is not a wiki link.
  if (!inner.trim() || /[[\]\n]/.test(inner)) {
    return undefined;
  }

  const pipe = inner.indexOf('|');
  const linkPart = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
  const labelPart = pipe >= 0 ? inner.slice(pipe + 1).trim() : '';
  if (!linkPart) {
    return undefined;
  }

  const hash = linkPart.indexOf('#');
  const target = hash >= 0 ? linkPart.slice(0, hash).trim() : linkPart;
  // Obsidian block references (`#^id`) have nothing to anchor to here; the heading form
  // does, so keep whatever follows the hash and let the page look for it.
  const fragment = hash >= 0 ? linkPart.slice(hash + 1).replace(/^\^/, '').trim() : '';

  // Obsidian's display rules: an alias wins, otherwise the note name, with the heading
  // appended when one is given. `[[#Heading]]` shows just the heading.
  const label =
    labelPart || (target ? (fragment ? `${target} > ${fragment}` : target) : fragment);

  return { target, fragment, label, embed, end: close + 2 };
}

/**
 * Obsidian-style wiki links.
 *
 * Resolved links are pushed as ordinary link tokens carrying the resolved `file:` URI, so
 * everything downstream — classification, the per-document link ids that Back scrolls to,
 * click handling — treats them exactly like a normal Markdown link. Unresolved ones are
 * rendered as plain marked-up text rather than a link to nowhere.
 */
export function wikiLinkPlugin(md: MarkdownIt, options?: { fallback: WikiLinkFallback }): void {
  md.inline.ruler.before('link', 'mdx_wiki_link', (state: StateInline, silent: boolean) => {
    const code = state.src.charCodeAt(state.pos);
    if (code !== BRACKET && code !== BANG) {
      return false;
    }
    const parsed = parse(state.src, state.pos);
    if (!parsed) {
      return false;
    }
    if (silent) {
      state.pos = parsed.end;
      return true;
    }

    const env = state.env as WikiLinkEnv;
    // `[[#Heading]]` stays on the current document.
    const resolved = parsed.target
      ? env.wikiIndex?.resolve(parsed.target, env.docUri, {
          root: env.wikiRoot,
          fallback: options?.fallback,
        })
      : { uri: env.docUri, exists: true };
    const label = parsed.label;

    if (!resolved) {
      pushMissing(state, label, parsed.target);
      state.pos = parsed.end;
      return true;
    }

    if (parsed.embed && !/\.(md|markdown|mdown|mkd|mkdn)$/i.test(resolved.uri.path)) {
      // `![[picture.png]]` is an image; embedding another document is transclusion, which
      // this preview does not do, so those fall through to a link below.
      const token = state.push('image', 'img', 0);
      token.attrs = [
        ['src', resolved.uri.toString()],
        ['alt', ''],
      ];
      token.content = label;
      const alt = new state.Token('text', '', 0);
      alt.content = label;
      token.children = [alt];
      state.pos = parsed.end;
      return true;
    }

    if (!resolved.exists) {
      pushMissing(state, label, parsed.target);
      state.pos = parsed.end;
      return true;
    }

    const sameDocument = resolved.uri.toString() === env.docUri.toString();
    const href = sameDocument
      ? `#${parsed.fragment}`
      : parsed.fragment
        ? resolved.uri.with({ fragment: parsed.fragment }).toString()
        : resolved.uri.toString();

    const open = state.push('link_open', 'a', 1);
    open.attrs = [
      ['href', href],
      // Marked so a link that left the document's own wiki is visibly different.
      ['class', resolved.crossWiki ? 'mdx-wikilink mdx-wikilink-external' : 'mdx-wikilink'],
    ];
    const text = state.push('text', '', 0);
    text.content = label;
    state.push('link_close', 'a', -1);

    state.pos = parsed.end;
    return true;
  });

  md.renderer.rules.wiki_link_missing = (tokens, idx) => {
    const token = tokens[idx];
    return `<span class="mdx-wikilink-missing" title="No file named ${escapeHtml(
      String(token.meta ?? '')
    )}">${escapeHtml(token.content)}</span>`;
  };
}

function pushMissing(state: StateInline, label: string, target: string): void {
  const token = state.push('wiki_link_missing', '', 0);
  token.content = label;
  token.meta = target;
}
