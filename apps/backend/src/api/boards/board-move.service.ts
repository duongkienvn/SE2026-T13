import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BoardVisibility, RealtimeServerEvent } from '@kanban/shared';
import { Repository } from 'typeorm';
import { Board } from './entities/board.entity';
import { BoardAuthorizationService } from '../board-members/board-authorization.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { lockWorkspace } from '../workspaces/workspace-access';
import { requireBoardCreation } from '../workspaces/workspace-policy';
import { BoardRoomCoordinator } from '../../realtime/board-room-coordinator.service';
import { BoardEventPublisher } from '../../realtime/board-event-publisher.service';
import { ActivityWriterService } from '../activities/activity-writer.service';
import {
  ActivityActionType,
  ActivityEntityType,
} from '../../common/enums/database-enums';
import { toBoardResponseDto } from './dto/board-response.dto';
import { recordWorkspaceActivity } from '../workspaces/workspace-activity-writer';

@Injectable()
export class BoardMoveService {
  constructor(
    @InjectRepository(Board) private readonly boards: Repository<Board>,
    private readonly authorization: BoardAuthorizationService,
    private readonly workspaces: WorkspacesService,
    private readonly coordinator: BoardRoomCoordinator,
    private readonly events: BoardEventPublisher,
    private readonly activities: ActivityWriterService,
  ) {}

  async move(actor: string, boardId: string, destinationId: string) {
    destinationId = destinationId.toLowerCase();
    const result = await this.coordinator.withReadGrantChanges(() =>
      this.coordinator.run(boardId, async () => {
        const outcome = await this.boards.manager.transaction(
          async (manager) => {
            const { board, member } =
              await this.authorization.requireMutableOwner(
                actor,
                boardId,
                manager,
              );
            for (const id of [
              ...new Set([board.workspaceId, destinationId]),
            ].sort())
              await lockWorkspace(manager, id);
            const destination = await this.workspaces.requireMember(
              actor,
              destinationId,
              manager,
            );
            requireBoardCreation(destination);
            if (board.workspaceId === destinationId) {
              board.workspace = destination.workspace;
              return {
                board: toBoardResponseDto(board, member.role),
                changed: false,
              };
            }
            const sourceId = board.workspaceId;
            const oldVisibility = board.visibility;
            const recipients: { userId: string }[] = await manager.query(
              `SELECT user_id AS "userId" FROM workspace_members WHERE workspace_id = ANY($1::uuid[])
               UNION SELECT user_id AS "userId" FROM board_members WHERE board_id = $2`,
              [[sourceId, destinationId], board.id],
            );
            board.workspaceId = destinationId;
            board.visibility = BoardVisibility.PRIVATE;
            await manager.getRepository(Board).save(board);
            board.workspace = destination.workspace;
            await manager.query(
              `INSERT INTO board_workspace_moves
            (board_id, actor_id, source_workspace_id, destination_workspace_id, old_visibility, new_visibility)
            VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                board.id,
                actor,
                sourceId,
                destinationId,
                oldVisibility,
                board.visibility,
              ],
            );
            await this.activities.record(manager, {
              boardId: board.id,
              actorId: actor,
              actionType: ActivityActionType.BOARD_UPDATED,
              entityType: ActivityEntityType.BOARD,
              entityId: board.id,
              metadata: null,
            });
            const [version]: { version: number }[] = await manager.query(
              'SELECT activity_move_version AS version FROM boards WHERE id = $1',
              [board.id],
            );
            await recordWorkspaceActivity(manager, {
              workspaceId: destinationId,
              actorId: actor,
              eventType: 'BOARD_MOVED',
              boardId: board.id,
              boardMoveVersion: version.version,
            });
            return {
              board: toBoardResponseDto(board, member.role),
              changed: true,
              recipients: recipients.map(({ userId }) => userId),
            };
          },
        );
        if (outcome.changed) {
          await this.coordinator.reconcileBoard(boardId, (userId) =>
            this.authorization.canReadBoard(userId, boardId),
          );
          this.coordinator.notifyAccessChanged(outcome.recipients ?? []);
        }
        return outcome;
      }),
    );
    if (result.changed)
      await this.events.publish(RealtimeServerEvent.BOARD_ACCESS_CHANGED, {
        boardId,
      });
    return result.board;
  }
}
