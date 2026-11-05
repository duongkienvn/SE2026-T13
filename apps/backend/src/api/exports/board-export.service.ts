import { Injectable } from '@nestjs/common';
import {
  BOARD_EXPORT_CARD_LIMIT,
  BOARD_EXPORT_CSV_HEADERS,
  type BoardDataExport,
  type BoardExportFormat,
  type ExportCard,
} from '@kanban/shared';
import { EntityManager, In, ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { Board } from '../boards/entities/board.entity';
import { BoardColumn } from '../columns/entities/board-column.entity';
import { Card } from '../cards/entities/card.entity';
import { BoardLabel } from '../labels/entities/board-label.entity';
import { BoardMember } from '../board-members/entities/board-member.entity';
import { CardAssignee } from '../cards/entities/card-assignee.entity';
import { CardLabel } from '../cards/entities/card-label.entity';
import { CardChecklist } from '../cards/entities/card-checklist.entity';
import { CardChecklistItem } from '../cards/entities/card-checklist-item.entity';
import { CardAttachment } from '../cards/entities/card-attachment.entity';
import { Comment } from '../comments/entities/comment.entity';
import { CommentMention } from '../comments/entities/comment-mention.entity';
import {
  ExportBuffer,
  ExportSizeBudget,
  exportTooLarge,
} from './export-buffer';
import {
  ExportSnapshot,
  exportPages,
  snapshotAuthorization,
} from './export-snapshot';
import { csvRow } from './export-csv';

const cardFields = [
  'id',
  'boardId',
  'columnId',
  'title',
  'description',
  'position',
  'startDate',
  'dueDate',
  'isArchived',
  'archivedAt',
  'createdById',
  'createdAt',
  'updatedAt',
];
export function selectFields(
  builder: SelectQueryBuilder<ObjectLiteral>,
  alias: string,
  fields: string[],
): SelectQueryBuilder<ObjectLiteral> {
  return builder.select(
    fields.map((field) => `${alias}.${field} AS "${field}"`),
  );
}
@Injectable()
export class BoardExportService {
  constructor(private readonly snapshots: ExportSnapshot) {}
  async create(
    userId: string,
    boardId: string,
    format: BoardExportFormat,
  ): Promise<Buffer> {
    return this.snapshots.read(async (manager) => {
      const { board } = await snapshotAuthorization(manager).requireOwner(
        userId,
        boardId,
      );
      if (
        (await manager.getRepository(Card).countBy({ boardId })) >
        BOARD_EXPORT_CARD_LIMIT
      )
        throw exportTooLarge();
      return format === 'csv'
        ? this.csv(manager, board)
        : this.json(manager, board);
    });
  }
  private scoped(
    manager: EntityManager,
    entity:
      typeof Card | typeof BoardColumn | typeof BoardLabel | typeof BoardMember,
    fields: string[],
    boardId: string,
    order = 'id',
  ) {
    return selectFields(
      manager.getRepository(entity).createQueryBuilder('row'),
      'row',
      fields,
    )
      .where('row.boardId = :boardId', { boardId })
      .orderBy(`row.${order}`, 'ASC')
      .addOrderBy('row.id', 'ASC');
  }
  private async array(
    output: ExportBuffer,
    builder: SelectQueryBuilder<ObjectLiteral>,
  ): Promise<void> {
    output.append('[');
    let first = true;
    for await (const page of exportPages(builder))
      for (const row of page) {
        if (!first) output.append(',');
        first = false;
        output.json(row);
      }
    output.append(']');
  }
  private async json(manager: EntityManager, board: Board): Promise<Buffer> {
    const output = new ExportBuffer();
    const metadata: BoardDataExport['board'] = {
      id: board.id,
      name: board.name,
      description: board.description,
      workspaceId: board.workspaceId,
      visibility: board.visibility,
      backgroundPreset: board.backgroundPreset,
      isArchived: board.isArchived,
      archivedAt: board.archivedAt?.toISOString() ?? null,
      createdAt: board.createdAt.toISOString(),
      updatedAt: board.updatedAt.toISOString(),
    };
    output.append('{"schemaVersion":1,"generatedAt":');
    output.json(new Date().toISOString());
    output.append(',"board":');
    output.json(metadata);
    output.append(',"columns":');
    await this.array(
      output,
      this.scoped(
        manager,
        BoardColumn,
        ['id', 'boardId', 'name', 'position', 'createdAt', 'updatedAt'],
        board.id,
        'position',
      ),
    );
    output.append(',"cards":[');
    let first = true;
    const cards = this.scoped(manager, Card, cardFields, board.id, 'columnId')
      .addOrderBy('row.position', 'ASC')
      .addOrderBy('row.id', 'ASC');
    // Column order follows exact numeric position, then Card position/id, including archives.
    cards
      .innerJoin('row.column', 'column')
      .orderBy('column.position', 'ASC')
      .addOrderBy('column.id', 'ASC')
      .addOrderBy('row.position', 'ASC')
      .addOrderBy('row.id', 'ASC');
    for await (const page of exportPages<ExportCard>(cards)) {
      await this.nested(manager, board.id, page);
      for (const card of page) {
        if (!first) output.append(',');
        first = false;
        output.json(card);
      }
    }
    output.append('],"labels":');
    await this.array(
      output,
      this.scoped(manager, BoardLabel, ['id', 'name', 'color'], board.id),
    );
    output.append(',"boardMembers":');
    const members = this.scoped(
      manager,
      BoardMember,
      ['id', 'userId', 'role'],
      board.id,
    )
      .innerJoin('row.user', 'user')
      .addSelect('user.displayName', 'displayName');
    await this.array(output, members);
    output.append('}');
    return output.finish();
  }
  private async nested(
    manager: EntityManager,
    boardId: string,
    cards: ExportCard[],
  ): Promise<void> {
    const byId = new Map(
      cards.map((card) => {
        Object.assign(card, {
          assigneeIds: [],
          labelIds: [],
          checklists: [],
          attachments: [],
          comments: [],
        });
        return [card.id, card] as const;
      }),
    );
    const cardIds = cards.map((card) => card.id);
    // A separate bounded budget protects temporary batch materialization; no joined products.
    const budget = new ExportSizeBudget();
    const collect = async <T>(
      query: SelectQueryBuilder<ObjectLiteral>,
      add: (row: T) => void,
    ) => {
      for await (const page of exportPages<T>(query))
        for (const row of page) {
          // Parent association IDs are not repeated inside nested JSON objects.
          const value = row as Record<string, unknown>;
          const fields = Object.fromEntries(
            Object.entries(value).filter(
              ([key]) => !['cardId', 'checklistId', 'commentId'].includes(key),
            ),
          );
          budget.json(
            'userId' in fields && Object.keys(fields).length === 1
              ? fields.userId
              : 'labelId' in fields && Object.keys(fields).length === 1
                ? fields.labelId
                : fields,
          );
          add(row);
        }
    };
    const child = (
      entity:
        | typeof CardAssignee
        | typeof CardLabel
        | typeof CardChecklist
        | typeof CardAttachment
        | typeof Comment,
      fields: string[],
      order = 'id',
    ) =>
      selectFields(
        manager.getRepository(entity).createQueryBuilder('child'),
        'child',
        fields,
      )
        .innerJoin(
          Card,
          'card',
          'card.id = child.cardId AND card.boardId = :boardId',
          { boardId },
        )
        .where('child.cardId IN (:...cardIds)', { cardIds })
        .orderBy(`child.${order}`, 'ASC')
        .addOrderBy('child.id', 'ASC');
    await collect<{ cardId: string; userId: string }>(
      child(CardAssignee, ['cardId', 'userId'], 'userId'),
      (row) => byId.get(row.cardId)!.assigneeIds.push(row.userId),
    );
    // CardLabel has a composite primary key and no id.
    const labels = selectFields(
      manager.getRepository(CardLabel).createQueryBuilder('link'),
      'link',
      ['cardId', 'labelId'],
    )
      .where({ boardId, cardId: In(cardIds) })
      .orderBy('link.cardId', 'ASC')
      .addOrderBy('link.labelId', 'ASC');
    await collect<{ cardId: string; labelId: string }>(labels, (row) =>
      byId.get(row.cardId)!.labelIds.push(row.labelId),
    );
    type ChecklistRow = ExportCard['checklists'][number] & { cardId: string };
    const lists = new Map<string, ChecklistRow>();
    await collect<ChecklistRow>(
      child(
        CardChecklist,
        ['id', 'cardId', 'title', 'position', 'createdAt', 'updatedAt'],
        'position',
      ),
      (row) => {
        const { cardId, ...list } = row;
        list.items = [];
        lists.set(row.id, { ...list, cardId });
        byId.get(cardId)!.checklists.push(list);
      },
    );
    const items = selectFields(
      manager.getRepository(CardChecklistItem).createQueryBuilder('item'),
      'item',
      [
        'id',
        'checklistId',
        'text',
        'position',
        'isChecked',
        'createdAt',
        'updatedAt',
      ],
    )
      .innerJoin('item.checklist', 'list')
      .innerJoin('list.card', 'card')
      .where('card.boardId = :boardId AND card.id IN (:...cardIds)', {
        boardId,
        cardIds,
      })
      .orderBy('item.position', 'ASC')
      .addOrderBy('item.id', 'ASC');
    await collect<
      ExportCard['checklists'][number]['items'][number] & {
        checklistId: string;
      }
    >(items, (row) => {
      const { checklistId, ...item } = row;
      lists.get(checklistId)!.items.push(item);
    });
    await collect<ExportCard['attachments'][number] & { cardId: string }>(
      child(CardAttachment, [
        'id',
        'cardId',
        'kind',
        'state',
        'displayName',
        'originalFilename',
        'mimeType',
        'byteSize',
        'url',
      ]).andWhere("child.state = 'ACTIVE'"),
      (row) => {
        const { cardId, ...attachment } = row;
        byId.get(cardId)!.attachments.push(attachment);
      },
    );
    type CommentRow = ExportCard['comments'][number] & { cardId: string };
    const comments = new Map<string, CommentRow>();
    await collect<CommentRow>(
      child(
        Comment,
        ['id', 'cardId', 'authorId', 'content', 'createdAt', 'updatedAt'],
        'createdAt',
      ),
      (row) => {
        const { cardId, ...comment } = row;
        comment.mentions = [];
        comments.set(row.id, { ...comment, cardId });
        byId.get(cardId)!.comments.push(comment);
      },
    );
    const mentions = selectFields(
      manager.getRepository(CommentMention).createQueryBuilder('mention'),
      'mention',
      ['commentId', 'userId', 'start', 'end'],
    )
      .innerJoin('mention.comment', 'comment')
      .innerJoin('comment.card', 'card')
      .where('card.boardId = :boardId AND card.id IN (:...cardIds)', {
        boardId,
        cardIds,
      })
      .orderBy('mention.start', 'ASC')
      .addOrderBy('mention.id', 'ASC');
    await collect<{
      commentId: string;
      userId: string;
      start: number;
      end: number;
    }>(mentions, (row) => {
      const { commentId, ...mention } = row;
      const comment = comments.get(commentId);
      if (
        comment &&
        mention.start >= 0 &&
        mention.end <= comment.content.length &&
        mention.end > mention.start
      )
        comment.mentions.push(mention);
    });
  }
  private async csv(manager: EntityManager, board: Board): Promise<Buffer> {
    const output = new ExportBuffer();
    output.append(BOARD_EXPORT_CSV_HEADERS.join(',') + '\r\n');
    const query = this.scoped(manager, Card, cardFields, board.id)
      .innerJoin('row.column', 'column')
      .addSelect('column.name', 'columnName')
      .orderBy('column.position', 'ASC')
      .addOrderBy('column.id', 'ASC')
      .addOrderBy('row.position', 'ASC')
      .addOrderBy('row.id', 'ASC')
      .addSelect(
        "(SELECT COALESCE(string_agg(a.user_id::text, ';' ORDER BY a.user_id), '') FROM card_assignees a WHERE a.card_id = row.id)",
        'assignees',
      )
      .addSelect(
        "(SELECT COALESCE(string_agg(l.name, ';' ORDER BY l.name COLLATE \"C\", l.id), '') FROM card_labels cl JOIN board_labels l ON l.id=cl.label_id AND l.board_id=cl.board_id WHERE cl.card_id=row.id AND cl.board_id=row.board_id)",
        'labels',
      )
      .addSelect(
        '(SELECT count(*) FROM card_checklist_items i JOIN card_checklists c ON c.id=i.checklist_id WHERE c.card_id=row.id AND i.is_checked)',
        'checklistDone',
      )
      .addSelect(
        '(SELECT count(*) FROM card_checklist_items i JOIN card_checklists c ON c.id=i.checklist_id WHERE c.card_id=row.id)',
        'checklistTotal',
      )
      .addSelect(
        "(SELECT count(*) FROM card_attachments a WHERE a.card_id=row.id AND a.board_id=row.board_id AND a.state='ACTIVE')",
        'attachmentCount',
      )
      .addSelect(
        '(SELECT count(*) FROM comments c WHERE c.card_id=row.id AND c.deleted_at IS NULL)',
        'commentCount',
      );
    for await (const page of exportPages<Record<string, unknown>>(query))
      for (const row of page) {
        row.boardName = board.name;
        row.cardId = row.id;
        output.append(
          csvRow(
            BOARD_EXPORT_CSV_HEADERS.map((key) =>
              row[key] instanceof Date ? row[key].toISOString() : row[key],
            ),
          ),
        );
      }
    return output.finish();
  }
}
