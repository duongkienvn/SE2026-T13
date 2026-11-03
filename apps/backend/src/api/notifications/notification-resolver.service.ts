import { Injectable } from '@nestjs/common';
import { NotificationKind, type NotificationResponse } from '@kanban/shared';
import { isUUID } from 'class-validator';
import type { EntityManager } from 'typeorm';
import { Board } from '../boards/entities/board.entity';
import { Card } from '../cards/entities/card.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import {
  readableBoardParameters,
  readableBoardPredicate,
} from '../board-members/board-permissions';
import { toResponseDto } from '../../common/dto/to-response-dto';
import { NotificationResponseDto } from './dto/notification-response.dto';
import type { UserNotification } from './entities/user-notification.entity';
import {
  NotificationInvitationResolvers,
  type VerifiedNotificationInvitation,
} from './notification-invitation-resolvers';
import { notificationScope } from './notification-record';

const UNAVAILABLE = 'This notification is no longer available';
const cardKinds = new Set<NotificationKind>([
  NotificationKind.CARD_ASSIGNED,
  NotificationKind.COMMENT_MENTIONED,
  NotificationKind.DUE_REMINDER,
]);
function safeName(value: string): string {
  return [
    ...value
      .replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  ]
    .slice(0, 300)
    .join('');
}
interface ReadableBoard {
  id: string;
  name: string;
  workspaceId: string;
}
interface ReadableCard {
  id: string;
  title: string;
  boardId: string;
}
type Resolved = Pick<NotificationResponse, 'context' | 'target' | 'summary'> & {
  invitationActor?: boolean;
};

@Injectable()
export class NotificationResolver {
  constructor(private readonly invitations: NotificationInvitationResolvers) {}

  async resolve(
    manager: EntityManager,
    recipient: string,
    rows: readonly UserNotification[],
  ): Promise<NotificationResponseDto[]> {
    if (!rows.length) return [];
    const boards = new Map<string, ReadableBoard>(),
      cards = new Map<string, ReadableCard>(),
      workspaces = new Map<string, string>();
    const boardIds = [
      ...new Set(rows.flatMap((row) => (row.boardId ? [row.boardId] : []))),
    ];
    if (boardIds.length)
      for (const board of await manager
        .getRepository(Board)
        .createQueryBuilder('board')
        .where(readableBoardPredicate, readableBoardParameters(recipient))
        .andWhere('board.id IN (:...boardIds)', { boardIds })
        .select('board.id', 'id')
        .addSelect('board.name', 'name')
        .addSelect('board.workspaceId', 'workspaceId')
        .getRawMany<ReadableBoard>())
        boards.set(board.id, board);
    const cardIds = rows.flatMap((row) => (row.cardId ? [row.cardId] : []));
    if (cardIds.length && boards.size)
      for (const card of await manager
        .getRepository(Card)
        .createQueryBuilder('card')
        .where(
          'card.id IN (:...cardIds) AND card.boardId IN (:...readableIds)',
          { cardIds, readableIds: [...boards.keys()] },
        )
        .select('card.id', 'id')
        .addSelect('card.title', 'title')
        .addSelect('card.boardId', 'boardId')
        .getRawMany<ReadableCard>())
        cards.set(card.id, card);
    const workspaceIds = rows
      .filter((row) => !row.boardId && row.workspaceId)
      .map((row) => row.workspaceId!);
    if (workspaceIds.length)
      for (const workspace of await manager
        .getRepository(Workspace)
        .createQueryBuilder('workspace')
        .where('workspace.id IN (:...workspaceIds)', { workspaceIds })
        .andWhere(
          'EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=workspace.id AND wm.user_id=:recipient)',
          { recipient },
        )
        .select('workspace.id', 'id')
        .addSelect('workspace.name', 'name')
        .getRawMany<{ id: string; name: string }>())
        workspaces.set(workspace.id, workspace.name);
    const verified = await this.invitations.resolve(manager, recipient, rows);
    const resolutions = new Map<string, Resolved>();
    for (const row of rows) {
      const board = row.boardId ? boards.get(row.boardId) : undefined;
      if (
        row.kind === NotificationKind.WORKSPACE_INVITED ||
        row.kind === NotificationKind.BOARD_INVITED
      ) {
        const resolution = this.invitation(row, verified.get(row.id), boards);
        if (resolution) resolutions.set(row.id, resolution);
      } else if (cardKinds.has(row.kind)) {
        const card = row.cardId ? cards.get(row.cardId) : undefined;
        if (!board || !card || card.boardId !== board.id) continue;
        const name = safeName(card.title);
        const summary =
          row.kind === NotificationKind.CARD_ASSIGNED
            ? `You were assigned to "${name}"`
            : row.kind === NotificationKind.COMMENT_MENTIONED
              ? `You were mentioned in a comment on "${name}"`
              : `Due reminder for "${name}"`;
        resolutions.set(row.id, {
          summary,
          context: {
            workspaceId: board.workspaceId,
            boardId: board.id,
            cardId: card.id,
          },
          target: {
            kind: 'card',
            path: `/boards/${board.id}/cards/${card.id}`,
          },
        });
      } else if (row.kind === NotificationKind.MEMBERSHIP_CHANGED) {
        if (notificationScope(row) === 'board' && board)
          resolutions.set(row.id, {
            summary: `Your access to "${safeName(board.name)}" changed`,
            context: {
              workspaceId: board.workspaceId,
              boardId: board.id,
              cardId: null,
            },
            target: { kind: 'board', path: `/boards/${board.id}` },
          });
        else if (
          notificationScope(row) === 'workspace' &&
          !row.boardId &&
          row.workspaceId &&
          workspaces.has(row.workspaceId)
        )
          resolutions.set(row.id, {
            summary: `Your membership in "${safeName(workspaces.get(row.workspaceId)!)}" changed`,
            context: {
              workspaceId: row.workspaceId,
              boardId: null,
              cardId: null,
            },
            target: {
              kind: 'workspace',
              path: `/workspaces/${row.workspaceId}`,
            },
          });
      }
    }
    // Only current, authorized contexts reach the actor query. Match each actor
    // to THIS notification's scope, rather than any other Board on the page.
    const scopes = rows.flatMap((row) => {
      const resolved = resolutions.get(row.id);
      return resolved?.context && row.actorUserId
        ? [
            {
              notificationId: row.id,
              actorId: row.actorUserId,
              ...resolved.context,
              invitationActor: resolved.invitationActor === true,
            },
          ]
        : [];
    });
    const actorMap = new Map<string, { id: string; displayName: string }>();
    if (scopes.length) {
      const actors: {
        notificationId: string;
        id: string;
        displayName: string;
      }[] = await manager.query(
        `
        SELECT scope."notificationId", actor.id, actor.display_name AS "displayName"
        FROM jsonb_to_recordset($1::jsonb) AS scope("notificationId" uuid,"actorId" uuid,"workspaceId" uuid,"boardId" uuid,"cardId" uuid,"invitationActor" boolean)
        JOIN users actor ON actor.id=scope."actorId"
        WHERE actor.id=$2::uuid OR scope."invitationActor" OR
          (scope."boardId" IS NOT NULL AND EXISTS(SELECT 1 FROM board_members bm WHERE bm.board_id=scope."boardId" AND bm.user_id=actor.id)) OR
          (scope."boardId" IS NULL AND scope."workspaceId" IS NOT NULL AND EXISTS(SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=scope."workspaceId" AND wm.user_id=actor.id))`,
        [JSON.stringify(scopes), recipient],
      );
      for (const actor of actors)
        actorMap.set(actor.notificationId, {
          id: actor.id,
          displayName: actor.displayName,
        });
    }
    return rows.map((row) => {
      const resolved = resolutions.get(row.id);
      return toResponseDto(NotificationResponseDto, {
        id: row.id,
        kind: row.kind,
        createdAt: row.createdAt.toISOString(),
        readAt: row.readAt?.toISOString() ?? null,
        actor: resolved ? (actorMap.get(row.id) ?? null) : null,
        summary: resolved?.summary ?? UNAVAILABLE,
        context: resolved?.context ?? null,
        target: resolved?.target ?? null,
        isUnavailable: !resolved,
      });
    });
  }

  private invitation(
    row: UserNotification,
    verified: VerifiedNotificationInvitation | undefined,
    boards: Map<string, ReadableBoard>,
  ): Resolved | undefined {
    if (
      !verified ||
      typeof verified.name !== 'string' ||
      !safeName(verified.name)
    )
      return;
    if (
      (verified.workspaceId !== null && !isUUID(verified.workspaceId)) ||
      (verified.boardId !== null && !isUUID(verified.boardId))
    )
      return;
    if (
      row.kind === NotificationKind.WORKSPACE_INVITED &&
      (!row.workspaceId ||
        verified.workspaceId !== row.workspaceId ||
        verified.boardId !== null)
    )
      return;
    if (
      row.kind === NotificationKind.BOARD_INVITED &&
      (!row.boardId || verified.boardId !== row.boardId)
    )
      return;
    let target: NotificationResponse['target'] = null;
    const destination = verified.destination;
    if (
      row.kind === NotificationKind.WORKSPACE_INVITED &&
      destination?.kind === 'workspaceInvitation' &&
      /^[A-Za-z0-9_-]{43}$/.test(destination.proof)
    )
      target = {
        kind: 'invitation',
        path: `/invitations/workspace#proof=${destination.proof}`,
      };
    else if (
      destination?.kind === 'board' &&
      destination.boardId === verified.boardId &&
      boards.has(destination.boardId)
    )
      target = { kind: 'board', path: `/boards/${destination.boardId}` };
    return {
      summary: `You were invited to "${safeName(verified.name)}"`,
      context: {
        workspaceId: verified.workspaceId,
        boardId: verified.boardId,
        cardId: null,
      },
      target,
      invitationActor: verified.actorVisible === true,
    };
  }
}
