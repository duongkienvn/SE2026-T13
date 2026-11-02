import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RealtimeServerEvent } from '@kanban/shared';
import { Board } from './entities/board.entity';
import { BoardUserState } from './entities/board-user-state.entity';
import { BoardAuthorizationService } from '../board-members/board-authorization.service';
import {
  readableBoardParameters,
  readableBoardPredicate,
} from '../board-members/board-permissions';
import { ApplicationException } from '../../exceptions/application.exception';
import { lockWorkspace } from '../workspaces/workspace-access';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { BoardEventPublisher } from '../../realtime/board-event-publisher.service';
import { BOARD_BACKGROUND_IDS } from './board-backgrounds';
import { toBoardResponseDto } from './dto/board-response.dto';
import { ActivityWriterService } from '../activities/activity-writer.service';
import {
  ActivityActionType,
  ActivityEntityType,
} from '../../common/enums/database-enums';

@Injectable()
export class BoardDiscoveryService {
  constructor(
    @InjectRepository(Board) private readonly boards: Repository<Board>,
    private readonly authorization: BoardAuthorizationService,
    private readonly events: BoardEventPublisher,
    private readonly activities: ActivityWriterService,
  ) {}

  async state(userId: string, boardId: string) {
    const state = await this.boards
      .createQueryBuilder('board')
      .leftJoin(
        BoardUserState,
        'userState',
        'userState.boardId = board.id AND userState.userId = :userId',
        { userId },
      )
      .select('userState.isStarred', 'isStarred')
      .addSelect('userState.lastViewedAt', 'lastViewedAt')
      .where('board.id = :boardId', { boardId })
      .andWhere(readableBoardPredicate, readableBoardParameters(userId))
      .getRawOne<{ isStarred: boolean | null; lastViewedAt: Date | null }>();
    if (!state)
      throw new ApplicationException(404, 'NOT_FOUND', 'Board not found');
    return {
      isStarred: state.isStarred ?? false,
      lastViewedAt: state.lastViewedAt?.toISOString() ?? null,
    };
  }

  async setStar(userId: string, boardId: string, starred: boolean) {
    return this.writeState(userId, boardId, starred ? 'star' : 'unstar');
  }

  async view(userId: string, boardId: string) {
    return this.writeState(userId, boardId, 'view');
  }

  private async writeState(
    userId: string,
    boardId: string,
    action: 'star' | 'unstar' | 'view',
  ) {
    return this.boards.manager.transaction(async (manager) => {
      const board = await manager.getRepository(Board).findOne({
        where: { id: boardId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!board)
        throw new ApplicationException(404, 'NOT_FOUND', 'Board not found');
      await lockWorkspace(manager, board.workspaceId);
      const readable = await manager
        .getRepository(Board)
        .createQueryBuilder('board')
        .where('board.id = :boardId', { boardId })
        .andWhere(readableBoardPredicate, readableBoardParameters(userId))
        .getExists();
      if (!readable)
        throw new ApplicationException(404, 'NOT_FOUND', 'Board not found');
      if (action === 'view') {
        // Serialize retention across tabs and Boards for this user.
        await manager.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [
          userId,
        ]);
        await manager.query(
          `INSERT INTO board_user_states(user_id, board_id, last_viewed_at)
          VALUES ($1, $2, clock_timestamp()) ON CONFLICT (user_id, board_id) DO UPDATE
          SET last_viewed_at = EXCLUDED.last_viewed_at
          WHERE board_user_states.last_viewed_at IS NULL OR board_user_states.last_viewed_at < EXCLUDED.last_viewed_at - interval '1 minute'`,
          [userId, boardId],
        );
        await manager.query(
          `UPDATE board_user_states SET last_viewed_at = NULL WHERE user_id = $1 AND board_id IN
          (SELECT board_id FROM board_user_states WHERE user_id = $1 AND last_viewed_at IS NOT NULL ORDER BY last_viewed_at DESC, board_id DESC OFFSET 100)`,
          [userId],
        );
      } else if (action === 'star') {
        await manager.query(
          `INSERT INTO board_user_states(user_id, board_id, is_starred) VALUES ($1, $2, $3)
          ON CONFLICT (user_id, board_id) DO UPDATE SET is_starred = EXCLUDED.is_starred`,
          [userId, boardId, action === 'star'],
        );
      } else {
        await manager.query(
          'UPDATE board_user_states SET is_starred = false WHERE user_id = $1 AND board_id = $2',
          [userId, boardId],
        );
      }
      await manager.query(
        `DELETE FROM board_user_states WHERE user_id = $1 AND NOT is_starred AND last_viewed_at IS NULL${action === 'view' ? '' : ' AND board_id = $2'}`,
        action === 'view' ? [userId] : [userId, boardId],
      );
      const state = await manager
        .getRepository(BoardUserState)
        .findOneBy({ userId, boardId });
      return {
        isStarred: state?.isStarred ?? false,
        lastViewedAt: state?.lastViewedAt?.toISOString() ?? null,
      };
    });
  }

  async background(
    userId: string,
    boardId: string,
    preset: string,
    expectedVersion?: number,
  ) {
    if (!(BOARD_BACKGROUND_IDS as readonly string[]).includes(preset))
      throw new ApplicationException(
        400,
        'VALIDATION_FAILED',
        'Invalid background preset',
      );
    const result = await this.boards.manager.transaction(async (manager) => {
      const { board, member } = await this.authorization.requireMutableOwner(
        userId,
        boardId,
        manager,
      );
      if (
        expectedVersion !== undefined &&
        (board.backgroundVersion ?? 0) !== expectedVersion
      )
        throw new ApplicationException(
          409,
          'BACKGROUND_CONFLICT',
          'Board background changed. Reload and try again.',
        );
      board.workspace = await manager
        .getRepository(Workspace)
        .findOneByOrFail({ id: board.workspaceId });
      const changed = board.backgroundPreset !== preset;
      if (changed) {
        board.backgroundPreset = preset;
        board.backgroundVersion = (board.backgroundVersion ?? 0) + 1;
        await manager.getRepository(Board).save(board);
        await this.activities.record(manager, {
          boardId,
          actorId: userId,
          actionType: ActivityActionType.BOARD_UPDATED,
          entityType: ActivityEntityType.BOARD,
          entityId: boardId,
          metadata: null,
        });
      }
      return { board: toBoardResponseDto(board, member.role), changed };
    });
    if (result.changed)
      await this.events.publish(RealtimeServerEvent.BOARD_ACCESS_CHANGED, {
        boardId,
      });
    return result.board;
  }
}
