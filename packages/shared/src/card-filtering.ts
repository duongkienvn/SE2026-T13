/** Board-local list filters. ID arrays are encoded as comma-separated UUIDs. */
export interface BoardCardFilters {
  q?: string;
  labelIds?: string[];
  assigneeIds?: string[];
  dueStatus?: 'NO_DUE_DATE' | 'OVERDUE' | 'DUE_TODAY' | 'UPCOMING';
  dueFrom?: string;
  dueTo?: string;
  columnId?: string;
  status?: 'active' | 'archived';
  page?: number;
  limit?: number;
}
export interface CardPreviewSummary {
  cardId: string;
  labelIds: string[];
  checklist: { checkedItems: number; totalItems: number };
  attachmentCount: number;
  commentCount: number;
}
export interface CardPreviewSummaries {
  summaries: CardPreviewSummary[];
}
