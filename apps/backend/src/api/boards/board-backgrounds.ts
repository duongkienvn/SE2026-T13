import type { BoardBackgroundPreset } from '@kanban/shared';

/** Stable server-controlled presets. Photo URLs are Unsplash-hosted photographs. */
export const BOARD_BACKGROUNDS = [
  { id: 'blue', kind: 'color', value: '#2563EB', foreground: 'light' },
  { id: 'indigo', kind: 'color', value: '#4F46E5', foreground: 'light' },
  { id: 'violet', kind: 'color', value: '#7C3AED', foreground: 'light' },
  { id: 'rose', kind: 'color', value: '#BE123C', foreground: 'light' },
  { id: 'orange', kind: 'color', value: '#C2410C', foreground: 'light' },
  { id: 'amber', kind: 'color', value: '#FCD34D', foreground: 'dark' },
  { id: 'green', kind: 'color', value: '#15803D', foreground: 'light' },
  { id: 'teal', kind: 'color', value: '#0F766E', foreground: 'light' },
  {
    id: 'mountains',
    kind: 'photo',
    value: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b',
    foreground: 'light',
  },
  {
    id: 'forest',
    kind: 'photo',
    value: 'https://images.unsplash.com/photo-1448375240586-882707db888b',
    foreground: 'light',
  },
  {
    id: 'coast',
    kind: 'photo',
    value: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee',
    foreground: 'light',
  },
  {
    id: 'lake',
    kind: 'photo',
    value: 'https://images.unsplash.com/photo-1470770841072-f978cf4d019e',
    foreground: 'light',
  },
] as const satisfies readonly BoardBackgroundPreset[];
export const BOARD_BACKGROUND_IDS = BOARD_BACKGROUNDS.map(
  (preset) => preset.id,
);
