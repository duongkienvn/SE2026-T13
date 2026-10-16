/* Client-side checks mirroring the Card Management DTO rules (#34). */

export const CARD_TITLE_MAX_LENGTH = 120;
export const CARD_DESCRIPTION_MAX_LENGTH = 2000;

export function validateCardTitle(value: string): string | undefined {
  const title = value.trim();
  if (!title) return 'Enter a card title.';
  if (title.length > CARD_TITLE_MAX_LENGTH)
    return `Title must be at most ${CARD_TITLE_MAX_LENGTH} characters.`;
  return undefined;
}

export function validateCardDescription(value: string): string | undefined {
  if (value.trim().length > CARD_DESCRIPTION_MAX_LENGTH)
    return `Description must be at most ${CARD_DESCRIPTION_MAX_LENGTH} characters.`;
  return undefined;
}

/** Empty or whitespace-only descriptions are sent as `null`. */
export function normalizeCardDescription(value: string): string | null {
  return value.trim() || null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * `<input type="date">` value ("2026-10-25") → the end of that day in the
 * user's timezone as ISO 8601, so a card turns overdue once its day is over.
 * Blank means no due date.
 */
export function dueDateFromInput(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString();
}

/** A stored due date → the local calendar day for `<input type="date">`. */
export function dueDateToInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
