import type {
  BoardSearchResult,
  CardSearchResult,
  GlobalSearchResults,
  SearchGroup,
  WorkspaceSearchResult,
} from '@kanban/shared';
import { GlobalSearchType } from '@kanban/shared';
import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';

class SearchItemDto {
  @Expose() @ApiProperty({ format: 'uuid' }) id!: string;
  @Expose() @ApiProperty() title!: string;
  @Expose() @ApiProperty({ type: String, nullable: true }) subtitle!:
    string | null;
  @Expose()
  @ApiProperty({
    description: 'Relative application route, never an external URL.',
  })
  path!: string;
}
export class WorkspaceSearchResultDto
  extends SearchItemDto
  implements WorkspaceSearchResult
{
  @Expose() @ApiProperty({ enum: ['workspace'] }) type!: 'workspace';
  @Expose()
  @ApiProperty({ type: String, nullable: true, example: null })
  declare subtitle: null;
}
class WorkspaceContextDto extends SearchItemDto {
  @Expose() @ApiProperty({ format: 'uuid' }) workspaceId!: string;
  @Expose()
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Null without separate Workspace membership, including Board Guests.',
  })
  workspaceName!: string | null;
}
export class BoardSearchResultDto
  extends WorkspaceContextDto
  implements BoardSearchResult
{
  @Expose() @ApiProperty({ enum: ['board'] }) type!: 'board';
}
export class CardSearchResultDto
  extends WorkspaceContextDto
  implements CardSearchResult
{
  @Expose() @ApiProperty({ enum: ['card'] }) type!: 'card';
  @Expose() @ApiProperty({ format: 'uuid' }) boardId!: string;
  @Expose() @ApiProperty() boardName!: string;
  @Expose()
  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: 160,
    description:
      'Bounded plain-text matched-description snippet, otherwise safe Board context. Render as text.',
  })
  declare subtitle: string | null;
}
class SearchGroupDto {
  @Expose() @ApiProperty({ minimum: 0 }) total!: number;
  @Expose() @ApiProperty() hasMore!: boolean;
}
export class WorkspaceSearchGroupDto
  extends SearchGroupDto
  implements SearchGroup<WorkspaceSearchResult>
{
  @Expose()
  @Type(() => WorkspaceSearchResultDto)
  @ApiProperty({ type: () => [WorkspaceSearchResultDto], maxItems: 50 })
  items!: WorkspaceSearchResultDto[];
}
export class BoardSearchGroupDto
  extends SearchGroupDto
  implements SearchGroup<BoardSearchResult>
{
  @Expose()
  @Type(() => BoardSearchResultDto)
  @ApiProperty({ type: () => [BoardSearchResultDto], maxItems: 50 })
  items!: BoardSearchResultDto[];
}
export class CardSearchGroupDto
  extends SearchGroupDto
  implements SearchGroup<CardSearchResult>
{
  @Expose()
  @Type(() => CardSearchResultDto)
  @ApiProperty({ type: () => [CardSearchResultDto], maxItems: 50 })
  items!: CardSearchResultDto[];
}
export class SearchGroupsDto {
  @Expose()
  @Type(() => WorkspaceSearchGroupDto)
  @ApiProperty({ type: WorkspaceSearchGroupDto })
  workspaces!: WorkspaceSearchGroupDto;
  @Expose()
  @Type(() => BoardSearchGroupDto)
  @ApiProperty({ type: BoardSearchGroupDto })
  boards!: BoardSearchGroupDto;
  @Expose()
  @Type(() => CardSearchGroupDto)
  @ApiProperty({ type: CardSearchGroupDto })
  cards!: CardSearchGroupDto;
}
export class SearchResponseDto implements GlobalSearchResults {
  @Expose() @ApiProperty() query!: string;
  @Expose() @ApiProperty({ enum: GlobalSearchType }) type!: GlobalSearchType;
  @Expose()
  @Type(() => SearchGroupsDto)
  @ApiProperty({ type: SearchGroupsDto })
  groups!: SearchGroupsDto;
}
