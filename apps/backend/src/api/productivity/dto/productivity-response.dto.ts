import type {
  HomeBoardSummary,
  HomeDashboard,
  TaskCardSummary,
  TaskGroupCounts,
} from '@kanban/shared';
import { TaskGroup } from '@kanban/shared';
import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { BOARD_BACKGROUND_IDS } from '../../boards/board-backgrounds';

export class TaskLabelDto {
  @Expose() @ApiProperty({ format: 'uuid' }) id!: string;
  @Expose() @ApiProperty() name!: string;
  @Expose() @ApiProperty() color!: string;
}

export class TaskCardSummaryDto implements TaskCardSummary {
  @Expose() @ApiProperty({ format: 'uuid' }) id!: string;
  @Expose() @ApiProperty({ format: 'uuid' }) boardId!: string;
  @Expose() @ApiProperty({ format: 'uuid' }) workspaceId!: string;
  @Expose() @ApiProperty() title!: string;
  @Expose() @ApiProperty() boardName!: string;
  @Expose() @ApiProperty() workspaceName!: string;
  @Expose() @ApiProperty({ format: 'uuid' }) columnId!: string;
  @Expose()
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  startDate!: string | null;
  @Expose()
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  dueDate!: string | null;
  @Expose() @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @Expose() @ApiProperty({ enum: TaskGroup }) group!: TaskGroup;
  @Expose()
  @ApiProperty({ example: '/boards/<boardId>/cards/<cardId>' })
  permalink!: string;
  @Expose()
  @Type(() => TaskLabelDto)
  @ApiProperty({ type: () => [TaskLabelDto], maxItems: 200 })
  labels!: TaskLabelDto[];
}

export class TaskGroupCountsDto implements TaskGroupCounts {
  @Expose() @ApiProperty({ minimum: 0 }) OVERDUE!: number;
  @Expose() @ApiProperty({ minimum: 0 }) NEXT_7_DAYS!: number;
  @Expose() @ApiProperty({ minimum: 0 }) LATER!: number;
  @Expose() @ApiProperty({ minimum: 0 }) NO_DUE_DATE!: number;
}

export class HomeBoardSummaryDto implements HomeBoardSummary {
  @Expose() @ApiProperty({ format: 'uuid' }) id!: string;
  @Expose() @ApiProperty({ format: 'uuid' }) workspaceId!: string;
  @Expose() @ApiProperty() name!: string;
  @Expose()
  @ApiProperty({ type: String, enum: BOARD_BACKGROUND_IDS })
  backgroundPreset!: HomeBoardSummary['backgroundPreset'];
  @Expose() @ApiProperty() isStarred!: boolean;
  @Expose()
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastViewedAt!: string | null;
  @Expose() @ApiProperty({ example: '/boards/<boardId>' }) path!: string;
}

type HomeSummary = HomeDashboard['summary'];
export class HomeSummaryDto implements HomeSummary {
  @Expose() @ApiProperty({ minimum: 0 }) assignedActiveCount!: number;
  @Expose() @ApiProperty({ minimum: 0 }) overdueCount!: number;
  @Expose() @ApiProperty({ minimum: 0 }) dueNext7DaysCount!: number;
  @Expose() @ApiProperty({ minimum: 0 }) workspaceCount!: number;
}

export class HomeDashboardDto implements HomeDashboard {
  @Expose()
  @Type(() => HomeSummaryDto)
  @ApiProperty({ type: HomeSummaryDto })
  summary!: HomeSummaryDto;
  @Expose()
  @Type(() => TaskCardSummaryDto)
  @ApiProperty({ type: () => [TaskCardSummaryDto], maxItems: 6 })
  upNext!: TaskCardSummaryDto[];
  @Expose()
  @Type(() => HomeBoardSummaryDto)
  @ApiProperty({ type: () => [HomeBoardSummaryDto], maxItems: 6 })
  starredBoards!: HomeBoardSummaryDto[];
  @Expose()
  @Type(() => HomeBoardSummaryDto)
  @ApiProperty({ type: () => [HomeBoardSummaryDto], maxItems: 6 })
  recentBoards!: HomeBoardSummaryDto[];
}
