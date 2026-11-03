import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  type EntityManager,
  type SelectQueryBuilder,
} from 'typeorm';
import {
  TaskGroup,
  type TaskCardSummary,
  type TaskGroupCounts,
  type PaginationMeta,
} from '@kanban/shared';
import { Card } from '../cards/entities/card.entity';
import {
  readableBoardParameters,
  readableBoardPredicate,
} from '../board-members/board-permissions';
import { ApplicationException } from '../../exceptions/application.exception';
import { paginate, pageOffset } from '../../common/dto/paginated-response';
import { toResponseDto } from '../../common/dto/to-response-dto';
import { MAX_BOARD_LABELS } from '../labels/labels.service';
import { TaskCardSummaryDto } from './dto/productivity-response.dto';
import { ListTasksDto } from './dto/list-tasks.dto';

interface Boundaries {
  today: Date;
  nextWeek: Date;
  rangeValid: boolean;
}
type TaskRow = Omit<
  TaskCardSummary,
  'labels' | 'permalink' | 'startDate' | 'dueDate' | 'updatedAt'
> & {
  startDate: Date | null;
  dueDate: Date | null;
  updatedAt: Date;
};

const groupSql = `CASE WHEN card.dueDate IS NULL THEN 'NO_DUE_DATE'
  WHEN card.dueDate < :today THEN 'OVERDUE'
  WHEN card.dueDate < :nextWeek THEN 'NEXT_7_DAYS' ELSE 'LATER' END`;
const prioritySql = `CASE WHEN card.dueDate IS NULL THEN 3
  WHEN card.dueDate < :today THEN 0
  WHEN card.dueDate < :nextWeek THEN 1 ELSE 2 END`;

@Injectable()
export class ProductivityService {
  constructor(
    @InjectRepository(Card) private readonly cards: Repository<Card>,
  ) {}

  async tasks(
    userId: string,
    input: ListTasksDto,
    now = new Date(),
  ): Promise<{
    data: TaskCardSummaryDto[];
    meta: PaginationMeta;
    groupCounts: TaskGroupCounts;
  }> {
    let offset: number;
    try {
      offset = pageOffset(input);
    } catch {
      throw new ApplicationException(
        400,
        'VALIDATION_FAILED',
        'Pagination offset must be a safe integer',
      );
    }
    return this.cards.manager.transaction(
      'REPEATABLE READ',
      async (manager) => {
        const boundaries = await this.boundaries(manager, userId, now, input);
        const base = this.eligible(manager, userId, boundaries, input);
        const groupCounts = await this.counts(base);
        const total =
          input.group === 'ALL'
            ? Object.values(groupCounts).reduce((sum, count) => sum + count, 0)
            : groupCounts[input.group];
        const page = base.clone();
        if (input.group !== 'ALL')
          page.andWhere(`${groupSql} = :group`, { group: input.group });
        this.order(page, input.sort);
        const data = await this.summaries(
          manager,
          page.offset(offset).limit(input.limit),
        );
        return { ...paginate(data, total, input), groupCounts };
      },
    );
  }

  /** PostgreSQL timezone rules perform civil-day arithmetic, never +168 elapsed hours.
   * The request clock and persisted preference are read once inside the response snapshot.
   */
  private async boundaries(
    manager: EntityManager,
    userId: string,
    now: Date,
    input?: ListTasksDto,
  ): Promise<Boundaries> {
    const [row]: Boundaries[] = await manager.query(
      `
      WITH preference AS (
        SELECT COALESCE((SELECT time_zone FROM user_preferences WHERE user_id = $1), 'UTC') AS zone
      ), local_day AS (
        SELECT ($2::timestamptz AT TIME ZONE zone)::date AS day, zone FROM preference
      )
      SELECT day::timestamp AT TIME ZONE zone AS today,
        (day + 7)::timestamp AT TIME ZONE zone AS "nextWeek",
        ($3::timestamptz IS NULL OR $4::timestamptz IS NULL OR $3::timestamptz < $4::timestamptz) AS "rangeValid"
      FROM local_day`,
      [userId, now, input?.dueFrom ?? null, input?.dueTo ?? null],
    );
    if (!row.rangeValid)
      throw new ApplicationException(
        400,
        'VALIDATION_FAILED',
        'dueFrom must be before dueTo',
      );
    return row;
  }

  private eligible(
    manager: EntityManager,
    userId: string,
    boundaries: Boundaries,
    input?: ListTasksDto,
  ) {
    // EXISTS avoids multiplying Cards by membership, assignments or matching labels.
    const query = manager
      .getRepository(Card)
      .createQueryBuilder('card')
      .innerJoin('card.board', 'board')
      .innerJoin('board.workspace', 'workspace')
      .where(readableBoardPredicate, readableBoardParameters(userId))
      .andWhere('board.isArchived = false AND card.isArchived = false')
      .andWhere(
        'EXISTS (SELECT 1 FROM card_assignees assignment WHERE assignment.card_id = card.id AND assignment.user_id = :userId)',
      )
      .setParameters({
        today: boundaries.today,
        nextWeek: boundaries.nextWeek,
      });
    if (input?.workspaceId)
      query.andWhere('board.workspaceId = :workspaceId', {
        workspaceId: input.workspaceId,
      });
    if (input?.boardId)
      query.andWhere('board.id = :boardId', { boardId: input.boardId });
    if (input?.labelIds)
      query.andWhere(
        'EXISTS (SELECT 1 FROM card_labels link WHERE link.card_id = card.id AND link.board_id = board.id AND link.label_id IN (:...labelIds))',
        { labelIds: input.labelIds },
      );
    if (input?.dueFrom)
      query.andWhere('card.dueDate >= CAST(:dueFrom AS timestamptz)', {
        dueFrom: input.dueFrom,
      });
    if (input?.dueTo)
      query.andWhere('card.dueDate < CAST(:dueTo AS timestamptz)', {
        dueTo: input.dueTo,
      });
    return query;
  }

  private async counts(
    base: SelectQueryBuilder<Card>,
  ): Promise<TaskGroupCounts> {
    const query = base.clone().select([]);
    for (const group of Object.values(TaskGroup))
      query.addSelect(
        `COUNT(*) FILTER (WHERE ${groupSql} = '${group}')`,
        group,
      );
    const row = await query.getRawOne<Record<TaskGroup, string>>();
    return {
      OVERDUE: Number(row!.OVERDUE),
      NEXT_7_DAYS: Number(row!.NEXT_7_DAYS),
      LATER: Number(row!.LATER),
      NO_DUE_DATE: Number(row!.NO_DUE_DATE),
    };
  }

  private order(query: SelectQueryBuilder<Card>, sort: ListTasksDto['sort']) {
    query.orderBy(prioritySql, 'ASC');
    if (sort === 'updatedAt') query.addOrderBy('card.updatedAt', 'DESC');
    else {
      if (sort === 'board') query.addOrderBy('LOWER(board.name)', 'ASC');
      query.addOrderBy('card.dueDate', 'ASC', 'NULLS LAST');
    }
    query.addOrderBy('card.id', 'ASC');
  }

  private async summaries(
    manager: EntityManager,
    query: SelectQueryBuilder<Card>,
  ): Promise<TaskCardSummaryDto[]> {
    const rows = await query
      .select('card.id', 'id')
      .addSelect('card.boardId', 'boardId')
      .addSelect('board.workspaceId', 'workspaceId')
      .addSelect('card.title', 'title')
      .addSelect('board.name', 'boardName')
      .addSelect('workspace.name', 'workspaceName')
      .addSelect('card.columnId', 'columnId')
      .addSelect('card.startDate', 'startDate')
      .addSelect('card.dueDate', 'dueDate')
      .addSelect('card.updatedAt', 'updatedAt')
      .addSelect(groupSql, 'group')
      .getRawMany<TaskRow>();
    if (!rows.length) return [];
    // One bounded batch, only for IDs selected under ACL in the same snapshot.
    const labels: (TaskCardSummary['labels'][number] & { cardId: string })[] =
      await manager.query(
        `
      SELECT "cardId", id, name, color FROM (
        SELECT link.card_id AS "cardId", label.id, label.name, label.color,
          row_number() OVER (PARTITION BY link.card_id ORDER BY LOWER(label.name), label.id) AS ordinal
        FROM card_labels link JOIN board_labels label ON label.id = link.label_id AND label.board_id = link.board_id
        WHERE link.card_id = ANY($1::uuid[])
      ) ranked WHERE ordinal <= $2 ORDER BY "cardId", ordinal`,
        [rows.map((row) => row.id), MAX_BOARD_LABELS],
      );
    const byCard = new Map<string, TaskCardSummary['labels']>();
    for (const label of labels) {
      const items = byCard.get(label.cardId) ?? [];
      items.push({ id: label.id, name: label.name, color: label.color });
      byCard.set(label.cardId, items);
    }
    return rows.map((row) =>
      toResponseDto(TaskCardSummaryDto, {
        ...row,
        startDate: row.startDate?.toISOString() ?? null,
        dueDate: row.dueDate?.toISOString() ?? null,
        updatedAt: row.updatedAt.toISOString(),
        permalink: `/boards/${row.boardId}/cards/${row.id}`,
        labels: byCard.get(row.id) ?? [],
      }),
    );
  }
}
