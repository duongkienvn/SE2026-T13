/** Public H1a response: author details are resolved from board members. */
export interface Comment {
  id: string;
  cardId: string;
  authorId: string;
  content: string;
  /**
   * P4-04 validated spans, sorted by start. Older records and readers without
   * Board member access get `[]`; an older server may omit the field.
   */
  mentions?: CommentMention[];
  createdAt: string;
  updatedAt: string;
}

/** UTF-16 `[start, end)` of `@` + display name in the exact comment content. */
export interface CommentMention {
  userId: string;
  start: number;
  end: number;
}

/** Always carries `mentions` (possibly `[]`) so an edit never clears or keeps spans by accident. */
export interface CommentRequest {
  content: string;
  mentions: CommentMention[];
}
