import {
  BoardRole,
  BoardVisibility,
  WorkspaceRole,
  WorkspaceType,
  type BoardCapabilities,
  type BoardBackgroundPresetId,
} from '@kanban/shared';
import { isUuid } from '../../infrastructure/auth/credential-record.ts';
import type { ResourceId } from '../../navigation/routes.ts';
import { isBoardPreset } from '../home/presets.ts';

function invalid(): never {
  throw new Error('Invalid Workspace response');
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}

export function workspaceId(value: unknown): ResourceId | null {
  return isUuid(value) && value.length === 36
    ? (value.toLowerCase() as ResourceId)
    : null;
}

function id(value: unknown): ResourceId {
  return workspaceId(value) ?? invalid();
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : invalid();
}

function name(value: unknown): string {
  const result = text(value);
  return result.trim() ? result : invalid();
}

function optional<T>(value: unknown, decode: (input: unknown) => T) {
  return value === null ? null : decode(value);
}

function instant(value: unknown): string {
  const iso = text(value);
  const parsed = new Date(iso);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === iso
    ? iso
    : invalid();
}

function flag(value: unknown): boolean {
  return typeof value === 'boolean' ? value : invalid();
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : invalid();
}

function memberOf<T>(values: readonly T[], value: unknown): T {
  return values.find((item) => item === value) ?? invalid();
}

const icons = ['briefcase', 'users', 'code', 'palette', 'layers'] as const;

/** Client projection of WorkspaceResponseDto, using shared domain enums. */
export function decodeWorkspace(value: unknown) {
  const row = record(value);
  return {
    id: id(row.id),
    type: memberOf(Object.values(WorkspaceType), row.type),
    name: name(row.name),
    description: optional(row.description, text),
    icon: optional(row.icon, (value) => memberOf(icons, value)),
    role: memberOf(Object.values(WorkspaceRole), row.role),
    canManage: flag(row.canManage),
    canCreateBoards: flag(row.canCreateBoards),
    joinedAt: instant(row.joinedAt),
    createdAt: instant(row.createdAt),
    updatedAt: instant(row.updatedAt),
  };
}

export type WorkspaceSummary = ReturnType<typeof decodeWorkspace>;

function boardCapabilities(value: unknown): BoardCapabilities {
  const row = record(value);
  return {
    canReadBoard: flag(row.canReadBoard),
    canWriteBoard: flag(row.canWriteBoard),
    canManageBoard: flag(row.canManageBoard),
    canManageMembers: flag(row.canManageMembers),
    canRestoreBoard: flag(row.canRestoreBoard),
  };
}

function background(value: unknown): BoardBackgroundPresetId {
  return isBoardPreset(value) ? value : invalid();
}

export function decodeWorkspaceBoard(
  value: unknown,
  expectedWorkspaceId: ResourceId,
) {
  const row = record(value);
  const boardWorkspaceId = id(row.workspaceId);
  const capabilities = boardCapabilities(row.capabilities);
  const visibility = memberOf(Object.values(BoardVisibility), row.visibility);
  const role = optional(row.currentUserRole, (value) =>
    memberOf(Object.values(BoardRole), value),
  );
  const memberCount = optional(row.memberCount, count);
  const isArchived = flag(row.isArchived);
  if (
    boardWorkspaceId !== expectedWorkspaceId ||
    !capabilities.canReadBoard ||
    (role === null &&
      (visibility !== BoardVisibility.WORKSPACE_VISIBLE ||
        memberCount !== null))
  )
    return invalid();
  return {
    id: id(row.id),
    workspaceId: boardWorkspaceId,
    name: name(row.name),
    description: optional(row.description, text),
    isArchived,
    archivedAt: optional(row.archivedAt, instant),
    updatedAt: instant(row.updatedAt),
    createdAt: instant(row.createdAt),
    visibility,
    currentUserRole: role,
    backgroundPreset: background(row.backgroundPreset),
    backgroundVersion: count(row.backgroundVersion),
    memberCount,
    canEdit: flag(row.canEdit),
    capabilities,
    ...(row.isStarred === undefined ? {} : { isStarred: flag(row.isStarred) }),
    ...(row.lastViewedAt === undefined
      ? {}
      : { lastViewedAt: optional(row.lastViewedAt, instant) }),
  };
}

export type WorkspaceBoard = ReturnType<typeof decodeWorkspaceBoard>;

export function decodeWorkspaceOverview(
  value: unknown,
  expectedWorkspaceId: ResourceId,
) {
  const row = record(value);
  const workspace = decodeWorkspace(row.workspace);
  const visibleBoardCount = count(row.visibleBoardCount);
  const activeBoardCount = count(row.activeBoardCount);
  const archivedBoardCount = count(row.archivedBoardCount);
  if (
    workspace.id !== expectedWorkspaceId ||
    visibleBoardCount !== activeBoardCount + archivedBoardCount ||
    !Array.isArray(row.recentBoards) ||
    row.recentBoards.length > 5
  )
    return invalid();
  return {
    workspace,
    visibleBoardCount,
    activeBoardCount,
    archivedBoardCount,
    memberCount: count(row.memberCount),
    recentBoards: row.recentBoards.map((board) =>
      decodeWorkspaceBoard(board, expectedWorkspaceId),
    ),
  };
}

export type WorkspaceOverview = ReturnType<typeof decodeWorkspaceOverview>;
