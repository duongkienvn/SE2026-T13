import type {
  BoardBackgroundPreset,
  BoardBackgroundPresetId,
  BoardDiscoveryFilters,
  BoardUserDiscoveryState,
  UpdateBoardBackgroundRequest,
} from '@kanban/shared';

const state: BoardUserDiscoveryState = { isStarred: true, lastViewedAt: null };
const filters: BoardDiscoveryFilters = {
  q: 'Board',
  starred: true,
  sort: 'recent',
};
const preset: BoardBackgroundPreset = {
  id: 'forest',
  kind: 'photo',
  value: 'https://example.test',
  foreground: 'light',
};
const update: UpdateBoardBackgroundRequest = { preset: preset.id };
// @ts-expect-error arbitrary URLs are not background preset identifiers
const invalid: BoardBackgroundPresetId = 'https://example.test';
// @ts-expect-error unsupported sort values are rejected by the contract
const invalidSort: BoardDiscoveryFilters = { sort: 'random' };
void [state, filters, preset, update, invalid, invalidSort];
