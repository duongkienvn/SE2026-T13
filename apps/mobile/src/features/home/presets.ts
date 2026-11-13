import type { BoardBackgroundPresetId } from '@kanban/shared';

/** Colors and photo IDs match BoardsController's preset catalog. */
const colors = {
  blue: '#2563EB',
  indigo: '#4F46E5',
  violet: '#7C3AED',
  rose: '#BE123C',
  orange: '#C2410C',
  amber: '#FCD34D',
  green: '#15803D',
  teal: '#0F766E',
  mountains: '#465A70',
  forest: '#315C49',
  coast: '#315D76',
  lake: '#425A75',
} satisfies Record<BoardBackgroundPresetId, string>;

export function isBoardPreset(
  value: unknown,
): value is BoardBackgroundPresetId {
  return typeof value === 'string' && Object.hasOwn(colors, value);
}

export function boardPresetColor(value: unknown, fallback: string) {
  return isBoardPreset(value) ? colors[value] : fallback;
}
