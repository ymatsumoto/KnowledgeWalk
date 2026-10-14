import * as vscode from 'vscode';
import type { WebviewConfig } from './protocol';
import type { FrontMatterMode } from './renderer/frontMatter';
import type { LinkifyMode } from './renderer/markdown';
import type { WikiLinkFallback } from './wikiIndex';

export interface MdxConfig {
  doubleClickToEdit: boolean;
  mermaid: boolean;
  math: boolean;
  allowRawHtml: boolean;
  frontMatter: FrontMatterMode;
  /** `mdExplorer.frontMatterDisplay`: the user layer of the card layout. */
  frontMatterDisplay: unknown;
  /** Front matter key that names a document's wiki root. */
  wikiRootKey: string;
  /** Extra extensions that mark a front matter value as a file, normalised to `.ext`. */
  knownFileExtensions: string[];
  wikiLinks: boolean;
  wikiRootMarkers: string[];
  wikiLinkFallback: WikiLinkFallback;
  linkify: LinkifyMode;
  maxHistoryLength: number;
  reclaimTextEditors: boolean;
  scrollOffset: number;
  retainHiddenPreviews: boolean;
}

export function readConfig(scope?: vscode.Uri): MdxConfig {
  const c = vscode.workspace.getConfiguration('mdExplorer', scope ?? null);
  return {
    doubleClickToEdit: c.get<boolean>('doubleClickToEdit', true),
    mermaid: c.get<boolean>('mermaid.enabled', true),
    math: c.get<boolean>('math.enabled', true),
    allowRawHtml: c.get<boolean>('allowRawHtml', true),
    frontMatter: c.get<FrontMatterMode>('frontMatter', 'auto'),
    frontMatterDisplay: c.get<unknown>('frontMatterDisplay', {}),
    wikiRootKey: rootKey(c.get<unknown>('wikiRootKey', 'root')),
    knownFileExtensions: extensions(c.get<unknown>('knownFileExtensions', [])),
    wikiLinks: c.get<boolean>('wikiLinks', true),
    wikiRootMarkers: c.get<string[]>('wikiRootMarkers', ['.obsidian']),
    wikiLinkFallback: c.get<WikiLinkFallback>('wikiLinkFallback', 'unique'),
    linkify: c.get<LinkifyMode>('linkify', 'urls'),
    maxHistoryLength: Math.max(2, c.get<number>('maxHistoryLength', 50)),
    reclaimTextEditors: c.get<boolean>('reclaimTextEditors', true),
    scrollOffset: Math.max(0, c.get<number>('scrollOffset', 8)),
    retainHiddenPreviews: c.get<boolean>('retainHiddenPreviews', true),
  };
}

function rootKey(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : 'root';
}

function extensions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    .map((item) => {
      const ext = item.trim().toLowerCase();
      return ext.startsWith('.') ? ext : `.${ext}`;
    });
}

export function toWebviewConfig(cfg: MdxConfig): WebviewConfig {
  return {
    doubleClickToEdit: cfg.doubleClickToEdit,
    mermaid: cfg.mermaid,
    scrollOffset: cfg.scrollOffset,
  };
}
