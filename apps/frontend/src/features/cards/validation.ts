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
