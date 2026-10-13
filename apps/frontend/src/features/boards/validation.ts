/* Client-side checks mirroring the Board Management DTO rules (#20). */

export const BOARD_NAME_MAX_LENGTH = 120;
export const BOARD_DESCRIPTION_MAX_LENGTH = 2000;

export function validateBoardName(value: string): string | undefined {
  const name = value.trim();
  if (!name) return 'Enter a board name.';
  if (name.length > BOARD_NAME_MAX_LENGTH)
    return `Board name must be at most ${BOARD_NAME_MAX_LENGTH} characters.`;
  return undefined;
}

export function validateBoardDescription(value: string): string | undefined {
  if (value.trim().length > BOARD_DESCRIPTION_MAX_LENGTH)
    return `Description must be at most ${BOARD_DESCRIPTION_MAX_LENGTH} characters.`;
  return undefined;
}

/** Empty or whitespace-only descriptions are sent as `null`. */
export function normalizeDescription(value: string): string | null {
  return value.trim() || null;
}
