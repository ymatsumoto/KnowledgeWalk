/**
 * How front matter keys are displayed.
 *
 * Three layers, later ones winning: the built-in defaults below, which know the OKF core
 * keys; the `mdExplorer.frontMatter.display` setting; and the `frontMatter:` section of a
 * `.mdexplorer.yaml` at the wiki root, which is where a wiki describes its own extension
 * keys. Objects merge key by key, arrays replace. `byType[type]` is applied last, by the
 * same rule, for the document's `type`.
 *
 * Keys nobody configured are shown by the `auto` rule (see the renderer), so a wiki gets
 * a readable card before it writes any configuration at all.
 *
 * Kept free of `vscode` so it can be tested directly.
 */

export const FIELD_KINDS = [
  'auto',
  'text',
  'badge',
  'chips',
  'date',
  'link',
  'links',
  'table',
  'template',
  'sources',
  'hidden',
] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export const COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray', 'none'] as const;
export type Color = (typeof COLORS)[number];

export interface FieldSpec {
  as: FieldKind;
  /** Badge colour per value. */
  colors?: Record<string, Color>;
  /** Badge or chip values not worth showing, such as the default `stable`. */
  hideValues?: string[];
  /** For `template`: `{key}`, `{key.sub}` and `{key|date}` placeholders. */
  template?: string;
  /** For links to Markdown files: show the target's `title`, or the path as written. */
  label?: 'title' | 'path';
}

export type DetailsMode = 'collapsed' | 'expanded' | 'hidden';

export interface DisplayConfig {
  /** Keys shown on the card's first line. `trust` is the verification tier. */
  header: string[];
  /** Key shown as the lead paragraph. */
  lead: string;
  /** Keys never shown. */
  hidden: string[];
  /** Omit `title` when the body's first heading already says the same thing. */
  hideTitleWhenSameAsH1: boolean;
  /** Everything not shown elsewhere. */
  details: DetailsMode;
  fields: Record<string, FieldSpec>;
  byType: Record<string, unknown>;
}

/** Keys with a place of their own on the card, never repeated under details. */
export const PLACED_KEYS = new Set(['title']);

export const DEFAULT_DISPLAY: DisplayConfig = {
  header: ['type', 'status', 'trust', 'generated', 'tags'],
  lead: 'description',
  hidden: ['okf_version', 'root'],
  hideTitleWhenSameAsH1: true,
  details: 'collapsed',
  fields: {
    type: { as: 'badge' },
    status: {
      as: 'badge',
      colors: { draft: 'yellow', stable: 'green', deprecated: 'gray' },
      hideValues: ['stable'],
    },
    tags: { as: 'chips' },
    generated: { as: 'template', template: '🤖 {by} · {at|date}' },
    // Summarised by the trust badge, which lists every confirmation on hover.
    verified: { as: 'hidden' },
    stale_after: { as: 'date' },
    resource: { as: 'link' },
    sources: { as: 'sources' },
    // Attested Computation (OKF §10).
    parameters: { as: 'table' },
  },
  byType: {},
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Objects merge key by key; arrays and scalars replace. */
function deepMerge(base: unknown, layer: unknown): unknown {
  if (!isRecord(base) || !isRecord(layer)) {
    return layer === undefined ? base : layer;
  }
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(layer)) {
    result[key] = deepMerge(base[key], value);
  }
  return result;
}

function stringList(value: unknown, where: string, warnings: string[]): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value as string[];
  }
  warnings.push(`${where} should be a list of key names`);
  return undefined;
}

function validField(key: string, value: unknown, warnings: string[]): FieldSpec {
  // A bare string is shorthand for `{ as: <string> }`.
  const spec = typeof value === 'string' ? { as: value } : value;
  if (!isRecord(spec)) {
    warnings.push(`fields.${key} should be a mapping such as { as: badge }`);
    return { as: 'auto' };
  }
  const result: FieldSpec = { as: 'auto' };
  if (spec.as !== undefined) {
    if ((FIELD_KINDS as readonly string[]).includes(String(spec.as))) {
      result.as = spec.as as FieldKind;
    } else {
      warnings.push(`fields.${key}.as: unknown display "${String(spec.as)}"; using auto`);
    }
  }
  if (spec.colors !== undefined) {
    if (isRecord(spec.colors)) {
      result.colors = {};
      for (const [value, color] of Object.entries(spec.colors)) {
        if ((COLORS as readonly string[]).includes(String(color))) {
          result.colors[value] = color as Color;
        } else {
          warnings.push(`fields.${key}.colors.${value}: unknown colour "${String(color)}"`);
        }
      }
    } else {
      warnings.push(`fields.${key}.colors should map values to colours`);
    }
  }
  const hideValues = stringList(spec.hideValues, `fields.${key}.hideValues`, warnings);
  if (hideValues) {
    result.hideValues = hideValues;
  }
  if (spec.template !== undefined) {
    if (typeof spec.template === 'string') {
      result.template = spec.template;
    } else {
      warnings.push(`fields.${key}.template should be a string`);
    }
  }
  if (spec.label !== undefined) {
    if (spec.label === 'title' || spec.label === 'path') {
      result.label = spec.label;
    } else {
      warnings.push(`fields.${key}.label should be "title" or "path"`);
    }
  }
  if (result.as === 'template' && !result.template) {
    warnings.push(`fields.${key}: "template" display needs a template; using auto`);
    result.as = 'auto';
  }
  return result;
}

const TOP_LEVEL = new Set(['header', 'lead', 'hidden', 'hideTitleWhenSameAsH1', 'details', 'fields', 'byType']);

/** Turn a merged, untyped configuration into a DisplayConfig, reporting what was dropped. */
function validate(merged: Record<string, unknown>, warnings: string[], where = ''): DisplayConfig {
  for (const key of Object.keys(merged)) {
    if (!TOP_LEVEL.has(key)) {
      warnings.push(`${where}${key}: unknown setting`);
    }
  }
  const header = stringList(merged.header, `${where}header`, warnings) ?? DEFAULT_DISPLAY.header;
  const hidden = stringList(merged.hidden, `${where}hidden`, warnings) ?? DEFAULT_DISPLAY.hidden;
  let lead = DEFAULT_DISPLAY.lead;
  if (typeof merged.lead === 'string') {
    lead = merged.lead;
  } else if (merged.lead !== undefined) {
    warnings.push(`${where}lead should be a key name`);
  }
  let details = DEFAULT_DISPLAY.details;
  if (merged.details === 'collapsed' || merged.details === 'expanded' || merged.details === 'hidden') {
    details = merged.details;
  } else if (merged.details !== undefined) {
    warnings.push(`${where}details should be collapsed, expanded or hidden`);
  }
  const hideTitleWhenSameAsH1 =
    typeof merged.hideTitleWhenSameAsH1 === 'boolean'
      ? merged.hideTitleWhenSameAsH1
      : DEFAULT_DISPLAY.hideTitleWhenSameAsH1;
  const fields: Record<string, FieldSpec> = {};
  if (isRecord(merged.fields)) {
    for (const [key, value] of Object.entries(merged.fields)) {
      fields[key] = validField(key, value, warnings);
    }
  } else if (merged.fields !== undefined) {
    warnings.push(`${where}fields should be a mapping of key names`);
  }
  const byType = isRecord(merged.byType) ? merged.byType : {};
  return { header, lead, hidden, hideTitleWhenSameAsH1, details, fields, byType };
}

export interface MergedDisplay {
  config: DisplayConfig;
  warnings: string[];
}

/** Layer configurations over the built-in defaults; undefined layers are skipped. */
export function mergeDisplay(...layers: unknown[]): MergedDisplay {
  const warnings: string[] = [];
  let merged: unknown = DEFAULT_DISPLAY;
  for (const layer of layers) {
    if (layer === undefined || layer === null) {
      continue;
    }
    if (!isRecord(layer)) {
      warnings.push('front matter display settings should be a mapping');
      continue;
    }
    merged = deepMerge(merged, layer);
  }
  return { config: validate(merged as Record<string, unknown>, warnings), warnings };
}

/** The configuration for one document, with `byType[type]` applied. */
export function displayForType(config: DisplayConfig, type: string | undefined): MergedDisplay {
  const warnings: string[] = [];
  const override = type === undefined ? undefined : config.byType[type];
  if (override === undefined) {
    return { config, warnings };
  }
  if (!isRecord(override)) {
    return { config, warnings: [`byType.${type} should be a mapping`] };
  }
  const merged = deepMerge(config, override) as Record<string, unknown>;
  return { config: validate(merged, warnings, `byType.${type}.`), warnings };
}

export function fieldSpec(config: DisplayConfig, key: string): FieldSpec {
  if (config.hidden.includes(key)) {
    return { as: 'hidden' };
  }
  return config.fields[key] ?? { as: 'auto' };
}

const PLACEHOLDER = /\{([^{}|]+)(?:\|([a-z]+))?\}/g;

/**
 * Fill a template's placeholders from `data`. The result is plain text: the caller
 * escapes it, so a template can never inject markup.
 */
export function fillTemplate(
  template: string,
  data: unknown,
  formatters: Record<string, (value: string) => string>
): string {
  return template.replace(PLACEHOLDER, (_whole, keyPath: string, format?: string) => {
    let value: unknown = data;
    for (const part of keyPath.trim().split('.')) {
      value = isRecord(value) ? value[part] : part === 'value' ? value : undefined;
    }
    if (value === undefined || value === null || typeof value === 'object') {
      return '';
    }
    const text = String(value);
    const formatter = format ? formatters[format] : undefined;
    return formatter ? formatter(text) : text;
  });
}
