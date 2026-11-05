import type { BoardRole } from './enums/board-role.js';
import type {
  BoardVisibility,
  WorkspaceRole,
  WorkspaceType,
} from './workspace.js';
import type {
  NotificationKind,
  NotificationPreferences,
} from './notifications.js';
import type { AttachmentKind } from './card-attachments.js';

export type BoardExportFormat = 'json' | 'csv';
export const BOARD_EXPORT_CARD_LIMIT = 10_000;
export const DATA_EXPORT_BYTE_LIMIT = 20 * 1024 * 1024;
export const BOARD_EXPORT_CSV_HEADERS = [
  'boardId',
  'boardName',
  'columnId',
  'columnName',
  'cardId',
  'title',
  'description',
  'position',
  'startDate',
  'dueDate',
  'isArchived',
  'assignees',
  'labels',
  'checklistDone',
  'checklistTotal',
  'attachmentCount',
  'commentCount',
  'createdAt',
  'updatedAt',
] as const;
export interface ExportTimestamps {
  createdAt: string;
  updatedAt: string;
}
export interface ExportArchive {
  isArchived: boolean;
  archivedAt: string | null;
}
export interface ExportMention {
  userId: string;
  start: number;
  end: number;
}
export interface ExportComment extends ExportTimestamps {
  id: string;
  authorId: string;
  content: string;
  mentions: ExportMention[];
}
export interface ExportAttachment {
  id: string;
  kind: AttachmentKind;
  state: 'ACTIVE';
  displayName: string;
  originalFilename: string | null;
  mimeType: string | null;
  byteSize: string | null;
  url: string | null;
}
export interface ExportChecklistItem extends ExportTimestamps {
  id: string;
  text: string;
  position: string;
  isChecked: boolean;
}
export interface ExportChecklist extends ExportTimestamps {
  id: string;
  title: string;
  position: string;
  items: ExportChecklistItem[];
}
export interface ExportCard extends ExportTimestamps, ExportArchive {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  description: string | null;
  position: string;
  startDate: string | null;
  dueDate: string | null;
  createdById: string;
  assigneeIds: string[];
  labelIds: string[];
  checklists: ExportChecklist[];
  attachments: ExportAttachment[];
  comments: ExportComment[];
}
export interface BoardDataExport {
  schemaVersion: 1;
  generatedAt: string;
  board: ExportTimestamps &
    ExportArchive & {
      id: string;
      name: string;
      description: string | null;
      workspaceId: string;
      visibility: BoardVisibility;
      backgroundPreset: string;
    };
  columns: (ExportTimestamps & {
    id: string;
    boardId: string;
    name: string;
    position: string;
  })[];
  cards: ExportCard[];
  labels: { id: string; name: string; color: string }[];
  boardMembers: {
    id: string;
    userId: string;
    role: BoardRole;
    displayName: string;
  }[];
}
export interface AccountDataExport {
  schemaVersion: 1;
  generatedAt: string;
  profile: ExportTimestamps & {
    userId: string;
    email: string;
    displayName: string;
    emailVerifiedAt: string | null;
    avatarUrl: string | null;
  };
  preferences: {
    theme: 'light' | 'dark' | 'system';
    timeZone: string;
    dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
    weekStartsOn: 'monday' | 'sunday';
    notifications: NotificationPreferences;
  };
  linkedProviders: { password: boolean; google: boolean };
  workspaceMemberships: {
    workspaceId: string;
    name: string;
    type: WorkspaceType;
    role: WorkspaceRole;
  }[];
  boardMemberships: {
    boardId: string;
    name: string;
    role: BoardRole;
    workspaceId: string;
  }[];
  notifications: {
    id: string;
    kind: NotificationKind;
    createdAt: string;
    readAt: string | null;
    workspaceId: string | null;
    boardId: string | null;
    cardId: string | null;
  }[];
  comments: (ExportTimestamps & {
    id: string;
    cardId: string;
    boardId: string;
    content: string;
  })[];
}
