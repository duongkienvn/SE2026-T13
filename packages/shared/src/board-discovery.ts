/** User-specific discovery state; never included in shared Board events. */
export interface BoardUserDiscoveryState {
  isStarred: boolean;
  lastViewedAt: string | null;
}

export type BoardDiscoverySort = 'createdAt' | 'updatedAt' | 'name' | 'recent';

export interface BoardDiscoveryFilters {
  q?: string;
  starred?: boolean;
  recent?: boolean;
  sort?: BoardDiscoverySort;
  status?: 'active' | 'archived';
}

export type BoardBackgroundPresetId =
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'rose'
  | 'orange'
  | 'amber'
  | 'green'
  | 'teal'
  | 'mountains'
  | 'forest'
  | 'coast'
  | 'lake';

export interface BoardBackgroundPreset {
  id: BoardBackgroundPresetId;
  kind: 'color' | 'photo';
  value: string;
  foreground: 'light' | 'dark';
}

export interface UpdateBoardBackgroundRequest {
  preset: BoardBackgroundPresetId;
}
