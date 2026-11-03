import type { EntityManager } from 'typeorm';
import { Card } from '../cards/entities/card.entity';
import {
  readableBoardParameters,
  readableBoardPredicate,
} from '../board-members/board-permissions';
import { toResponseDto } from '../../common/dto/to-response-dto';
import { CardSearchResultDto } from './dto/search-response.dto';
import type { SearchQueryDto } from './dto/search-query.dto';
import { joinReadableWorkspace } from './board-search';
import { searchPage, searchParameters } from './search-query';
import { plainSearchSnippet } from './search-snippet';

interface CardHit {
  id: string;
  title: string;
  boardId: string;
  boardName: string;
  workspaceId: string;
  workspaceName: string | null;
  fragment: string | null;
}

export function searchCards(
  manager: EntityManager,
  userId: string,
  input: SearchQueryDto,
) {
  const base = joinReadableWorkspace(
    manager
      .getRepository(Card)
      .createQueryBuilder('card')
      .innerJoin('card.board', 'board'),
  )
    .where(readableBoardPredicate, readableBoardParameters(userId))
    .andWhere('board.isArchived = false AND card.isArchived = false')
    .andWhere(
      "(card.title ILIKE :contains ESCAPE '\\' OR card.description ILIKE :contains ESCAPE '\\')",
      searchParameters(input.q),
    )
    .select('card.id', 'id')
    .addSelect('card.title', 'title')
    .addSelect('board.id', 'boardId')
    .addSelect('board.name', 'boardName')
    .addSelect('board.workspaceId', 'workspaceId')
    .addSelect('directory.name', 'workspaceName')
    // Never fetch a full description. Select a bounded fragment only for matched,
    // authorized page rows. Forty characters of preceding context keeps long hits useful.
    .addSelect(
      `CASE WHEN card.description ILIKE :contains ESCAPE '\\' THEN
      substring(card.description FROM GREATEST(1, strpos(LOWER(card.description), LOWER(:term)) - 40) FOR 240)
      ELSE NULL END`,
      'fragment',
    );
  return searchPage(
    base,
    input,
    { title: 'card.title', updatedAt: 'card.updatedAt', id: 'card.id' },
    (row: CardHit) =>
      toResponseDto(CardSearchResultDto, {
        ...row,
        type: 'card',
        subtitle:
          (row.fragment ? plainSearchSnippet(row.fragment) : '') ||
          plainSearchSnippet(row.boardName),
        path: `/boards/${row.boardId}/cards/${row.id}`,
      }),
  );
}
