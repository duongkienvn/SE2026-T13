export const BoardRole = {
  OWNER: 'OWNER',
  MEMBER: 'MEMBER',
} as const;

export type BoardRole = (typeof BoardRole)[keyof typeof BoardRole];
