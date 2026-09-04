import hljs from 'highlight.js/lib/common';

export interface Highlighted {
  html: string;
  language: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function highlightCode(code: string, language: string): Highlighted {
  if (language && hljs.getLanguage(language)) {
    try {
      return {
        html: hljs.highlight(code, { language, ignoreIllegals: true }).value,
        language,
      };
    } catch {
      // Fall through to the unhighlighted rendering below.
    }
  }
  return { html: escapeHtml(code), language: '' };
}
