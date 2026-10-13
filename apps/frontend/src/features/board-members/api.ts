import { apiRequest } from '../../lib/api-client';
import type {
  AddMemberRequest,
  BoardMember,
  UpdateMemberRoleRequest,
} from './types';

function membersPath(boardId: string, userId?: string): string {
  const base = `/boards/${encodeURIComponent(boardId)}/members`;
  return userId ? `${base}/${encodeURIComponent(userId)}` : base;
}

export function listMembers(
  accessToken: string,
  boardId: string,
  signal?: AbortSignal,
): Promise<BoardMember[]> {
  return apiRequest<BoardMember[]>(membersPath(boardId), {
    accessToken,
    signal,
  });
}

export function addMember(
  accessToken: string,
  boardId: string,
  input: AddMemberRequest,
): Promise<BoardMember> {
  return apiRequest<BoardMember>(membersPath(boardId), {
    method: 'POST',
    body: input,
    accessToken,
  });
}

export function updateMemberRole(
  accessToken: string,
  boardId: string,
  userId: string,
  input: UpdateMemberRoleRequest,
): Promise<BoardMember> {
  return apiRequest<BoardMember>(membersPath(boardId, userId), {
    method: 'PATCH',
    body: input,
    accessToken,
  });
}

export function removeMember(
  accessToken: string,
  boardId: string,
  userId: string,
): Promise<void> {
  return apiRequest<void>(membersPath(boardId, userId), {
    method: 'DELETE',
    accessToken,
  });
}
