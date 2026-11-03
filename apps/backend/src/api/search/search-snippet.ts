export const SEARCH_SNIPPET_LENGTH = 160;

/** Bounded query fragments only. This produces display text, never trusted HTML
 * or Markdown. Consumers must use text nodes rather than HTML/Markdown renderers.
 */
export function plainSearchSnippet(fragment: string): string {
  const plain = fragment
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~<>]/g, '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [...plain].slice(0, SEARCH_SNIPPET_LENGTH).join('');
}
