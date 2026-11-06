import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type {
  RemoveStarterBoardRequest,
  StarterBoardRemovalPreview,
} from '@kanban/shared';
import { BoardAuthorizationService } from '../board-members/board-authorization.service';
import { BoardRoomCoordinator } from '../../realtime/board-room-coordinator.service';
import { ApplicationException } from '../../exceptions/application.exception';
import { StarterBoardProvision } from './entities/starter-board-provision.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { Board } from './entities/board.entity';
import { starterBoardSnapshot } from './starter-board-snapshot';

@Injectable()
export class StarterBoardRemovalService {
  private readonly logger = new Logger(StarterBoardRemovalService.name);
  constructor(
    private readonly source: DataSource,
    private readonly authorization: BoardAuthorizationService,
    private readonly rooms: BoardRoomCoordinator,
  ) {}

  preview(
    userId: string,
    boardId: string,
  ): Promise<StarterBoardRemovalPreview> {
    return this.source.transaction((manager) =>
      this.inspect(manager, userId, boardId),
    );
  }

  async remove(
    userId: string,
    boardId: string,
    input: RemoveStarterBoardRequest,
  ): Promise<void> {
    await this.rooms.withReadGrantChanges(() =>
      this.rooms.run(boardId, async () => {
        await this.source.transaction(async (manager) => {
          const preview = await this.inspect(manager, userId, boardId);
          if (input.version !== preview.version)
            throw new ApplicationException(
              409,
              'STARTER_BOARD_CHANGED',
              'The sample board changed. Review a fresh removal confirmation.',
            );
          if (input.confirmation !== preview.confirmation)
            throw new ApplicationException(
              400,
              'VALIDATION_FAILED',
              'Type the exact confirmation phrase to remove this board.',
            );
          // Activity has a NO ACTION Board FK. Only owner-authored history is
          // eligible; remove it explicitly, then preserve all other FK safeguards.
          await manager.query('DELETE FROM activities WHERE board_id=$1', [
            boardId,
          ]);
          // Delete Cards before Columns because their column FK is RESTRICT.
          // Cascaded attachment deletes enqueue durable cleanup jobs in this tx.
          await manager.query('DELETE FROM cards WHERE board_id=$1', [boardId]);
          await manager.getRepository(Board).delete(boardId);
          // Enrollment survives with board_id=null through the SET NULL FK.
        });
        try {
          await this.rooms.reconcileBoard(boardId, async () => false);
          this.rooms.notifyAccessChanged([userId]);
        } catch {
          // Delivery never changes a committed REST outcome. Future reads/joins
          // remain DB-authorized even when the transport is unavailable.
          this.logger.warn('Removed sample board access delivery unavailable');
        }
      }),
    );
  }

  private async inspect(
    manager: EntityManager,
    userId: string,
    boardId: string,
  ): Promise<StarterBoardRemovalPreview> {
    const { board } = await this.authorization.requireOwner(
      userId,
      boardId,
      manager,
    );
    const enrollment = await manager
      .getRepository(StarterBoardProvision)
      .findOneBy({ userId, boardId });
    if (!enrollment)
      throw new ApplicationException(
        404,
        'STARTER_BOARD_NOT_FOUND',
        'This board is not your provisioned sample board.',
      );
    const workspace = await manager.getRepository(Workspace).findOne({
      where: { id: board.workspaceId },
      lock: { mode: 'pessimistic_read' },
    });
    if (
      board.createdById !== userId ||
      board.visibility !== 'PRIVATE' ||
      workspace?.type !== 'PERSONAL' ||
      workspace.createdById !== userId
    )
      throw this.unsafe();
    const [{ unsafe }]: { unsafe: boolean }[] = await manager.query(
      `SELECT
      EXISTS(SELECT 1 FROM board_members WHERE board_id=$1 AND user_id<>$2)
      OR EXISTS(SELECT 1 FROM cards WHERE board_id=$1 AND created_by_id<>$2)
      OR EXISTS(SELECT 1 FROM comments c JOIN cards k ON k.id=c.card_id WHERE k.board_id=$1 AND c.author_id<>$2)
      OR EXISTS(SELECT 1 FROM card_assignees a JOIN cards k ON k.id=a.card_id WHERE k.board_id=$1 AND (a.user_id<>$2 OR a.assigned_by_id<>$2))
      OR EXISTS(SELECT 1 FROM activities WHERE board_id=$1 AND (actor_id<>$2 OR entity_type='MEMBER'))
      OR EXISTS(SELECT 1 FROM workspace_activities WHERE board_id=$1)
      OR EXISTS(SELECT 1 FROM card_attachments WHERE board_id=$1 AND uploader_id<>$2)
      OR EXISTS(SELECT 1 FROM comment_mentions m JOIN comments c ON c.id=m.comment_id JOIN cards k ON k.id=c.card_id WHERE k.board_id=$1 AND m.user_id<>$2)
      OR EXISTS(SELECT 1 FROM user_notifications WHERE board_id=$1 AND recipient_user_id<>$2)
      OR EXISTS(SELECT 1 FROM task_notification_email_outbox WHERE board_id=$1 AND recipient_user_id<>$2)
      AS unsafe`,
      [boardId, userId],
    );
    if (unsafe) throw this.unsafe();
    const version = await starterBoardSnapshot(manager, boardId);
    const isCustomized = version !== enrollment.baselineHash;
    return {
      boardName: board.name,
      version,
      isCustomized,
      confirmation: isCustomized
        ? 'DELETE MY CUSTOMIZED BOARD'
        : 'REMOVE SAMPLE BOARD',
    };
  }

  private unsafe(): ApplicationException {
    return new ApplicationException(
      409,
      'STARTER_BOARD_REMOVAL_UNSAFE',
      'Sample removal is unavailable for shared boards, collaborative history, or boards moved outside their original Personal Workspace. Your data has not been removed.',
    );
  }
}
