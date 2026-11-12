import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { GlobalSearchResults } from '@kanban/shared';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { toResponseDto } from '../../common/dto/to-response-dto';
import { SearchResponseDto } from './dto/search-response.dto';
import { SearchQueryDto } from './dto/search-query.dto';
import { searchWorkspaces } from './workspace-search';
import { searchBoards } from './board-search';
import { searchCards } from './card-search';

@Injectable()
export class SearchService {
  constructor(
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
  ) {}

  async search(
    userId: string,
    input: SearchQueryDto,
  ): Promise<SearchResponseDto> {
    const result: GlobalSearchResults = {
      query: input.q,
      type: input.type,
      groups: {
        workspaces: { items: [], total: 0, hasMore: false },
        boards: { items: [], total: 0, hasMore: false },
        cards: { items: [], total: 0, hasMore: false },
      },
    };
    // Validation/trim happens at the HTTP boundary; an empty query must never
    // become an unfiltered database listing, including in type-specific mode.
    if (!input.q) return toResponseDto(SearchResponseDto, result);
    try {
    return await this.workspaces.manager.transaction(
      'REPEATABLE READ',
      async (manager) => {
        if (input.type === 'all' || input.type === 'workspaces')
          result.groups.workspaces = await searchWorkspaces(
            manager,
            userId,
            input,
          );
        if (input.type === 'all' || input.type === 'boards')
          result.groups.boards = await searchBoards(manager, userId, input);
        if (input.type === 'all' || input.type === 'cards')
          result.groups.cards = await searchCards(manager, userId, input);
        return toResponseDto(SearchResponseDto, result);
      },
    );
    } catch {
      // DELIBERATE MUTATION VT-053: falsely converts DB errors to empty results.
      return toResponseDto(SearchResponseDto, result);
    }
  }
}
