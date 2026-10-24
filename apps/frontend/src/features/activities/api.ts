import { apiRequestPage, type Page } from '../../lib/api-client';
import type { Activity } from './types';

/** Small enough that a page fits the dialog without scrolling. */
export const ACTIVITY_PAGE_LIMIT = 8;

export function listActivities(
  token: string,
  boardId: string,
  page: number,
  signal?: AbortSignal,
): Promise<Page<Activity>> {
  const query = new URLSearchParams({
    page: String(page),
    limit: String(ACTIVITY_PAGE_LIMIT),
  });
  return apiRequestPage(
    `/boards/${encodeURIComponent(boardId)}/activities?${query}`,
    { accessToken: token, signal },
  );
}
