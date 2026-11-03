import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import { SerializeResponse } from '../../decorators/response.decorators';
import {
  ApiBearerToken,
  ApiCommonErrors,
  ApiSuccess,
} from '../../decorators/swagger-response.decorators';
import { SearchQueryDto } from './dto/search-query.dto';
import { SearchResponseDto } from './dto/search-response.dto';
import { SearchService } from './search.service';

@ApiTags('search')
@Controller('search')
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(private readonly searches: SearchService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @SerializeResponse(SearchResponseDto)
  @ApiBearerToken()
  @ApiSuccess({
    type: SearchResponseDto,
    summary: 'Search authorized Workspaces, active Boards and Cards',
    description:
      'Literal case-insensitive substring; exact title, prefix, substring, then description-only Card matches. Each rank orders updatedAt DESC, UUID ASC. type=all returns independent first-page groups (default 5, max 10) and forbids page. Specific types default to page 1, limit 20 (max 50). Workspace names require separate Workspace membership. Empty q returns empty groups without business-data queries.',
  })
  @ApiCommonErrors([400, 401, 429, 500])
  search(
    @CurrentUser() user: AuthenticatedUser,
    @Query() input: SearchQueryDto,
  ): Promise<SearchResponseDto> {
    return this.searches.search(user.userId, input);
  }
}
