import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager, Repository } from 'typeorm';
import { ErrorCode } from '../../common/dto/api-error';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import {
  PaginatedResponse,
  pageOffset,
  paginate,
} from '../../common/dto/paginated-response';
import { ApplicationException } from '../../exceptions/application.exception';
import { BoardAuthorizationService } from '../board-members/board-authorization.service';
import { Activity } from './entities/activity.entity';
import { ActivityRecorder, RecordActivityInput } from './activity-recorder';
import { ActivityWriterService } from './activity-writer.service';
import { ActivityEntityType } from '../../common/enums/database-enums';
import {
  ActivityResponseDto,
  toActivityResponseDto,
} from './dto/activity-response.dto';

@Injectable()
export class ActivitiesService implements ActivityRecorder {
  constructor(
    @InjectRepository(Activity)
    private readonly activities: Repository<Activity>,
    private readonly authorization: BoardAuthorizationService,
    private readonly writer: ActivityWriterService,
  ) {}

  async list(
    userId: string,
    boardId: string,
    query: PageQueryDto,
  ): Promise<PaginatedResponse<ActivityResponseDto>> {
    try {
      pageOffset(query);
      if (query.limit > 100) throw new RangeError();
    } catch {
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'Validation failed',
        ['Pagination offset must be a safe integer'],
      );
    }

    const access = await this.authorization.requireRead(userId, boardId);
    const builder = this.activities
      .createQueryBuilder('activity')
      .where('activity.boardId = :boardId', { boardId });
    if (access.member === null)
      builder.andWhere('activity.entityType <> :memberEntityType', {
        memberEntityType: ActivityEntityType.MEMBER,
      });
    const [rows, total] = await builder
      .orderBy('activity.createdAt', 'DESC')
      .addOrderBy('activity.id', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return paginate(rows.map(toActivityResponseDto), total, query);
  }

  async record(
    manager: EntityManager,
    input: RecordActivityInput,
  ): Promise<void> {
    await this.writer.record(manager, input);
  }
}
