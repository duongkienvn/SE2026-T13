/** Public H1a response: author details are resolved from board members. */
export interface Comment {
  id: string;
  cardId: string;
  authorId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommentRequest {
  content: string;
}
