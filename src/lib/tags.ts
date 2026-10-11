/**
 * Tag parsing and serialization utilities.
 */

/**
 * Parses comma-separated tag strings into a trimmed, non-empty list of tag names.
 * Example: "Wedding, 2026, VIP, " -> ["Wedding", "2026", "VIP"]
 */
export function parseTagsString(input: string): string[] {
  if (!input || typeof input !== 'string') return [];
  return input
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

/**
 * Formats a list of tag objects or strings into a comma-separated string for form inputs.
 */
export function formatTagsString(tags: ({ name: string } | string)[]): string {
  if (!Array.isArray(tags)) return '';
  return tags
    .map((t) => (typeof t === 'string' ? t.trim() : t.name.trim()))
    .filter((name) => name.length > 0)
    .join(', ');
}
