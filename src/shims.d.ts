declare module 'markdown-it-footnote' {
  import type { PluginSimple } from 'markdown-it';
  const plugin: PluginSimple;
  export default plugin;
}

declare module 'markdown-it-task-lists' {
  import type { PluginWithOptions } from 'markdown-it';
  const plugin: PluginWithOptions<{
    enabled?: boolean;
    label?: boolean;
    labelAfter?: boolean;
  }>;
  export default plugin;
}

declare module 'markdown-it-front-matter' {
  import type { PluginWithOptions } from 'markdown-it';
  /** The plugin takes a callback that receives the raw front matter text. */
  const plugin: PluginWithOptions<(frontMatter: string) => void>;
  export default plugin;
}
