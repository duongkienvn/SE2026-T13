import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BoardVisibility, RealtimeServerEvent } from '@kanban/shared';
import { Repository } from 'typeorm';
import { Board } from './entities/board.entity';
import { BoardAuthorizationService } from '../board-members/board-authorization.service';
import { BoardRoomCoordinator } from '../../realtime/board-room-coordinator.service';
import { BoardEventPublisher } from '../../realtime/board-event-publisher.service';
import { toBoardResponseDto } from './dto/board-response.dto';
import { ApplicationException } from '../../exceptions/application.exception';
import { ActivityWriterService } from '../activities/activity-writer.service';
import { requireBoardPolicy } from '../workspaces/workspace-policy';
import {
  ActivityActionType,
  ActivityEntityType,
} from '../../common/enums/database-enums';

@Injectable()
export class BoardVisibilityService {
  constructor(
    @InjectRepository(Board) private readonly boards: Repository<Board>,
    private readonly authorization: BoardAuthorizationService,
    private readonly coordinator: BoardRoomCoordinator,
    private readonly events: BoardEventPublisher,
    private readonly activities: ActivityWriterService,
  ) {}

  async change(userId: string, boardId: string, visibility: BoardVisibility) {
    if (!Object.values(BoardVisibility).includes(visibility))
      throw new ApplicationException(
        400,
        'VALIDATION_FAILED',
        'Invalid Board visibility',
      );
    const result = await this.coordinator.run(boardId, async () => {
      const saved = await this.boards.manager.transaction(async (manager) => {
        const { board, member } = await this.authorization.requireMutableOwner(
          userId,
          boardId,
          manager,
        );
        board.workspace = await requireBoardPolicy(
          manager,
          board.workspaceId,
          'boardVisibilityChangesEnabled',
        );
        const changed = board.visibility !== visibility;
        if (changed) {
          board.visibility = visibility;
          await manager.getRepository(Board).save(board);
          await this.activities.record(manager, {
            boardId: board.id,
            actorId: userId,
            actionType: ActivityActionType.BOARD_UPDATED,
            entityType: ActivityEntityType.BOARD,
            entityId: board.id,
            metadata: null,
          });
        }
        const recipients: { userId: string }[] = changed
          ? await manager.query(
              `SELECT user_id AS "userId" FROM workspace_members WHERE workspace_id = $1
               UNION SELECT user_id AS "userId" FROM board_members WHERE board_id = $2`,
              [board.workspaceId, board.id],
            )
          : [];
        return { board: toBoardResponseDto(board, member.role), recipients };
      });
      await this.coordinator.reconcileBoard(boardId, (actor) =>
        this.authorization.canReadBoard(actor, boardId),
      );
      this.coordinator.notifyAccessChanged(
        saved.recipients.map(({ userId }) => userId),
      );
      return saved;
    });
    await this.events.publish(RealtimeServerEvent.BOARD_ACCESS_CHANGED, {
      boardId,
    });
    return result.board;
  }
}
