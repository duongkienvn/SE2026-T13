import { USER_A } from '../auth/support.ts';
import { board, uuid } from './fixtures.ts';

export const boardId = uuid(1001);
export const timestamp = '2026-11-13T09:00:00.000Z';
export const boardDetail = {
  ...board(),
  name: 'Product Roadmap',
  createdById: USER_A,
};
export const column = (index: number, position = `${index}.0000000000`) => ({
  id: uuid(2000 + index),
  boardId,
  name: `Column ${index}`,
  position,
  createdAt: timestamp,
  updatedAt: timestamp,
});
export const card = (index: number, columnId = column(1).id) => ({
  id: uuid(3000 + index),
  columnId,
  boardId,
  title: `Card ${index}`,
  position: `${index}.0000000000`,
  description: null,
  isArchived: false,
  startDate: null,
  dueDate: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  assignees: [],
});
export const preview = (cardId: string) => ({
  cardId,
  labelIds: [],
  checklist: { checkedItems: 1, totalItems: 2 },
  attachmentCount: 2,
  commentCount: 3,
});
