import { createContext } from 'react';
import type { CardPreviewSummary } from '@kanban/shared';
import type { Label } from '../../labels/api';
import { DEFAULT_PREFERENCES } from '../../settings/format';

export const PreviewContext = createContext({
  summaries: new Map<string, CardPreviewSummary>(),
  labels: [] as Label[],
  timeZone: DEFAULT_PREFERENCES.timeZone,
  dateFormat: DEFAULT_PREFERENCES.dateFormat,
  now: 0,
});
