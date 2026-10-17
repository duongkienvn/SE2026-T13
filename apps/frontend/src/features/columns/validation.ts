/* Client-side checks mirroring the Column Management DTO rules (#33). */

export const COLUMN_NAME_MAX_LENGTH = 120;

export function validateColumnName(value: string): string | undefined {
  const name = value.trim();
  if (!name) return 'Enter a column name.';
  if (name.length > COLUMN_NAME_MAX_LENGTH)
    return `Column name must be at most ${COLUMN_NAME_MAX_LENGTH} characters.`;
  return undefined;
}
