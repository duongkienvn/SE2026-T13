export const ActivityEntityType = {
  BOARD: 'BOARD',
  COLUMN: 'COLUMN',
  CARD: 'CARD',
  COMMENT: 'COMMENT',
  MEMBER: 'MEMBER',
} as const;

export type ActivityEntityType =
  (typeof ActivityEntityType)[keyof typeof ActivityEntityType];
