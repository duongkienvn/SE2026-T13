import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { NotificationKind } from '@kanban/shared';
import { isUUID } from 'class-validator';
import { Repository, type EntityManager } from 'typeorm';
import { Card } from '../cards/entities/card.entity';
import { Board } from '../boards/entities/board.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { User } from '../users/entities/user.entity';
import { UserNotification } from './entities/user-notification.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import {
  IN_APP_KIND_COLUMN,
  lockNotificationRecipient,
} from './notification-preferences';
import {
  NotificationRecordValidationError,
  type NotificationRecordResult,
  type RecordNotificationInput,
} from './notification-record';

const cardKinds = new Set<NotificationKind>([
  NotificationKind.CARD_ASSIGNED,
  NotificationKind.COMMENT_MENTIONED,
  NotificationKind.DUE_REMINDER,
]);

/** Persistence only. Domain callers own the transaction and publish AFTER it
 * resolves; no transport, mail, Auth module or domain producer is imported here.
 */
@Injectable()
export class NotificationService {
  constructor(
    @InjectRepository(UserNotification)
    private readonly notifications: Repository<UserNotification>,
  ) {}

  async record(
    manager: EntityManager,
    input: RecordNotificationInput,
  ): Promise<NotificationRecordResult> {
    this.validate(manager, input);
    const recipientUserId = input.recipientUserId.toLowerCase();
    const result = (
      status: NotificationRecordResult['status'],
      notificationId: string | null = null,
    ): NotificationRecordResult => ({
      status,
      notificationId,
      recipientUserId,
    });
    if (!(await lockNotificationRecipient(manager, recipientUserId)))
      return result('recipient-missing');
    const scope = cardKinds.has(input.kind)
      ? 'card'
      : input.boardId
        ? 'board'
        : 'workspace';
    const dedupeKey = `${input.kind}:${scope}:${input.occurrenceKey}`;
    const repository = manager.getRepository(UserNotification);
    const existing = await repository.findOneBy({ recipientUserId, dedupeKey });
    if (existing) return result('duplicate', existing.id);
    const preferences = await manager
      .getRepository(NotificationPreference)
      .findOneBy({ userId: recipientUserId });
    if (preferences?.[IN_APP_KIND_COLUMN[input.kind]] === false)
      return result('disabled');
    const context = await this.context(manager, input);
    if (
      input.actorUserId &&
      !(await manager.getRepository(User).existsBy({ id: input.actorUserId }))
    )
      throw new NotificationRecordValidationError();
    const inserted = await repository
      .createQueryBuilder()
      .insert()
      .values({
        recipientUserId,
        dedupeKey,
        kind: input.kind,
        actorUserId: input.actorUserId ?? null,
        ...context,
        readAt: null,
      })
      .orIgnore()
      .returning('id')
      .execute();
    const id = (inserted.raw as { id: string }[])[0]?.id;
    if (id) return result('created', id);
    // Unique recipient+dedupe is the final database fence, even if another
    // correctly scoped writer did not use this process/recipient lock.
    const duplicate = await repository.findOneByOrFail({
      recipientUserId,
      dedupeKey,
    });
    return result('duplicate', duplicate.id);
  }

  async recordMany(
    manager: EntityManager,
    inputs: readonly RecordNotificationInput[],
  ): Promise<NotificationRecordResult[]> {
    for (const input of inputs) this.validate(manager, input);
    for (const recipient of [
      ...new Set(inputs.map((input) => input.recipientUserId.toLowerCase())),
    ].sort())
      await lockNotificationRecipient(manager, recipient);
    const results: NotificationRecordResult[] = [];
    for (const input of inputs) results.push(await this.record(manager, input));
    return results;
  }

  private validate(
    manager: EntityManager,
    input: RecordNotificationInput,
  ): void {
    if (
      !manager.queryRunner?.isTransactionActive ||
      manager.connection !== this.notifications.manager.connection ||
      !input ||
      !Object.values(NotificationKind).includes(input.kind) ||
      !isUUID(input.recipientUserId, '4') ||
      typeof input.occurrenceKey !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9:._+-]{0,139}$/.test(input.occurrenceKey) ||
      [input.actorUserId, input.workspaceId, input.boardId, input.cardId].some(
        (value) => value !== undefined && !isUUID(value, '4'),
      ) ||
      (cardKinds.has(input.kind) && !input.cardId) ||
      (!cardKinds.has(input.kind) && input.cardId !== undefined) ||
      (input.kind === NotificationKind.WORKSPACE_INVITED &&
        (!input.workspaceId || input.boardId !== undefined)) ||
      (input.kind === NotificationKind.BOARD_INVITED && !input.boardId) ||
      (input.kind === NotificationKind.MEMBERSHIP_CHANGED &&
        !input.boardId &&
        !input.workspaceId)
    )
      throw new NotificationRecordValidationError();
  }

  private async context(
    manager: EntityManager,
    input: RecordNotificationInput,
  ): Promise<{
    workspaceId: string | null;
    boardId: string | null;
    cardId: string | null;
  }> {
    if (input.cardId) {
      const card = await manager
        .getRepository(Card)
        .createQueryBuilder('card')
        .innerJoin('card.board', 'board')
        .where('card.id=:id', { id: input.cardId })
        .select('card.id', 'id')
        .addSelect('board.id', 'boardId')
        .addSelect('board.workspaceId', 'workspaceId')
        .getRawOne<{ id: string; boardId: string; workspaceId: string }>();
      if (
        !card ||
        (input.boardId && card.boardId !== input.boardId.toLowerCase()) ||
        (input.workspaceId &&
          card.workspaceId !== input.workspaceId.toLowerCase())
      )
        throw new NotificationRecordValidationError();
      // Persist the narrowest root; derive current Workspace from the live Board.
      // Parent deletion/moves can never resurrect a lost Card as a Workspace item.
      return { cardId: card.id, boardId: card.boardId, workspaceId: null };
    }
    if (input.boardId) {
      const board = await manager
        .getRepository(Board)
        .findOne({
          where: { id: input.boardId },
          select: { id: true, workspaceId: true },
        });
      if (
        !board ||
        (input.workspaceId &&
          board.workspaceId !== input.workspaceId.toLowerCase())
      )
        throw new NotificationRecordValidationError();
      return { boardId: board.id, workspaceId: null, cardId: null };
    }
    if (
      !input.workspaceId ||
      !(await manager
        .getRepository(Workspace)
        .existsBy({ id: input.workspaceId }))
    )
      throw new NotificationRecordValidationError();
    return {
      workspaceId: input.workspaceId.toLowerCase(),
      boardId: null,
      cardId: null,
    };
  }
}
