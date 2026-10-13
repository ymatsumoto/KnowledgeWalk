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

export function toWebviewConfig(cfg: MdxConfig): WebviewConfig {
  return {
    doubleClickToEdit: cfg.doubleClickToEdit,
    mermaid: cfg.mermaid,
    scrollOffset: cfg.scrollOffset,
  };
}
