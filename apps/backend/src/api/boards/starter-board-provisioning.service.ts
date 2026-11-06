import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { BoardVisibility, WorkspaceType } from '@kanban/shared';
import { BoardMemberRole } from '../../common/enums/database-enums';
import { User } from '../users/entities/user.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { Board } from './entities/board.entity';
import { StarterBoardProvision } from './entities/starter-board-provision.entity';
import { BoardMember } from '../board-members/entities/board-member.entity';
import { BoardColumn } from '../columns/entities/board-column.entity';
import { BoardLabel } from '../labels/entities/board-label.entity';
import { Card } from '../cards/entities/card.entity';
import { CardLabel } from '../cards/entities/card-label.entity';
import { CardAssignee } from '../cards/entities/card-assignee.entity';
import { CardChecklist } from '../cards/entities/card-checklist.entity';
import { CardChecklistItem } from '../cards/entities/card-checklist-item.entity';
import {
  STARTER_BOARD_DESCRIPTION,
  STARTER_BOARD_NAME,
  STARTER_COLUMNS,
  STARTER_LABELS,
  STARTER_TEMPLATE_VERSION,
} from './starter-board-template';
import { starterBoardSnapshot } from './starter-board-snapshot';
import { appendPosition } from '../columns/columns-ordering';

const position = (index: number) => {
  let value = '0.0000000000';
  for (let step = 0; step <= index; step++) value = appendPosition(value);
  return value;
};

/** Internal signup-only persistence. No notifications, Activity or external I/O. */
@Injectable()
export class StarterBoardProvisioningService {
  async provision(
    manager: EntityManager,
    user: User,
    workspaceId: string,
  ): Promise<string | null> {
    if (!manager.queryRunner?.isTransactionActive)
      throw new Error(
        'Starter Board provisioning requires the registration transaction',
      );
    const active = await manager
      .getRepository(User)
      .findOne({ where: { id: user.id }, lock: { mode: 'pessimistic_write' } });
    if (!active || active.deletedAt)
      throw new Error('Starter Board requires a live account');
    const existing = await manager
      .getRepository(StarterBoardProvision)
      .findOneBy({ userId: user.id });
    if (existing) return existing.boardId;
    const workspace = await manager.getRepository(Workspace).findOneBy({
      id: workspaceId,
      createdById: user.id,
      type: WorkspaceType.PERSONAL,
    });
    if (!workspace)
      throw new Error('Starter Board requires the account Personal Workspace');
    const board = await manager.getRepository(Board).save(
      manager.create(Board, {
        name: STARTER_BOARD_NAME,
        description: STARTER_BOARD_DESCRIPTION,
        createdById: user.id,
        workspaceId,
        visibility: BoardVisibility.PRIVATE,
        backgroundPreset: 'indigo',
        isArchived: false,
        archivedAt: null,
      }),
    );
    await manager.getRepository(BoardMember).save(
      manager.create(BoardMember, {
        boardId: board.id,
        userId: user.id,
        role: BoardMemberRole.OWNER,
      }),
    );
    const labelIds = new Map<string, string>();
    for (const [name, color] of Object.entries(STARTER_LABELS)) {
      const label = await manager
        .getRepository(BoardLabel)
        .save(manager.create(BoardLabel, { boardId: board.id, name, color }));
      labelIds.set(name, label.id);
    }
    const date = (day?: number) =>
      day === undefined
        ? null
        : new Date(active.createdAt.getTime() + day * 86400000);
    for (const [index, template] of STARTER_COLUMNS.entries()) {
      const column = await manager.getRepository(BoardColumn).save(
        manager.create(BoardColumn, {
          boardId: board.id,
          name: template.name,
          position: position(index),
        }),
      );
      for (const [cardIndex, example] of template.cards.entries()) {
        const card = await manager.getRepository(Card).save(
          manager.create(Card, {
            boardId: board.id,
            columnId: column.id,
            createdById: user.id,
            title: example.title,
            description: example.description,
            position: position(cardIndex),
            startDate: date(example.startDay),
            dueDate: date(example.dueDay),
            isArchived: false,
            archivedAt: null,
          }),
        );
        await manager.getRepository(CardLabel).save(
          example.labels.map((name) =>
            manager.create(CardLabel, {
              boardId: board.id,
              cardId: card.id,
              labelId: labelIds.get(name)!,
            }),
          ),
        );
        if (example.assigned)
          await manager.getRepository(CardAssignee).save(
            manager.create(CardAssignee, {
              cardId: card.id,
              userId: user.id,
              assignedById: user.id,
            }),
          );
        const checklist = await manager.getRepository(CardChecklist).save(
          manager.create(CardChecklist, {
            cardId: card.id,
            title: example.checklist.title,
            position: position(0),
          }),
        );
        await manager.getRepository(CardChecklistItem).save(
          example.checklist.items.map((text, itemIndex) =>
            manager.create(CardChecklistItem, {
              checklistId: checklist.id,
              text,
              position: position(itemIndex),
              isChecked: itemIndex < example.checklist.checked,
            }),
          ),
        );
      }
    }
    await manager.getRepository(StarterBoardProvision).save(
      manager.create(StarterBoardProvision, {
        userId: user.id,
        boardId: board.id,
        templateVersion: STARTER_TEMPLATE_VERSION,
        baselineHash: await starterBoardSnapshot(manager, board.id),
      }),
    );
    return board.id;
  }
}
