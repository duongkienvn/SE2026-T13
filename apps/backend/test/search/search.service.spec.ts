import { Inject } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { SearchService } from '../../src/api/search/search.service';
import { SearchQueryDto } from '../../src/api/search/dto/search-query.dto';
import { Workspace } from '../../src/api/workspaces/entities/workspace.entity';
import { searchWorkspaces } from '../../src/api/search/workspace-search';
import { searchBoards } from '../../src/api/search/board-search';
import { searchCards } from '../../src/api/search/card-search';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => Inject('WorkspaceRepository'),
}));
jest.mock('../../src/api/search/workspace-search');
jest.mock('../../src/api/search/board-search');
jest.mock('../../src/api/search/card-search');

describe('search response snapshot and dispatch', () => {
  const manager = { transaction: jest.fn() },
    transaction = {};
  const service = new SearchService({
    manager,
  } as unknown as Repository<Workspace>);
  beforeEach(() => {
    jest.clearAllMocks();
    manager.transaction.mockImplementation((_level, callback) =>
      callback(transaction),
    );
    jest
      .mocked(searchWorkspaces)
      .mockResolvedValue({ items: [], total: 1, hasMore: false });
    jest
      .mocked(searchBoards)
      .mockResolvedValue({ items: [], total: 2, hasMore: false });
    jest
      .mocked(searchCards)
      .mockResolvedValue({ items: [], total: 3, hasMore: false });
  });
  it('propagates transaction startup failures instead of returning empty success', async () => {
    const outage = new Error('VT053_DB_FAILURE');
    manager.transaction.mockRejectedValueOnce(outage);
    await expect(
      service.search(
        'actor',
        Object.assign(new SearchQueryDto(), { q: 'needle', type: 'cards' }),
      ),
    ).rejects.toBe(outage);
    expect(searchCards).not.toHaveBeenCalled();
  });

  it('propagates a Card query failure inside the transaction', async () => {
    const outage = new Error('VT053_CARD_QUERY_FAILURE');
    jest.mocked(searchCards).mockRejectedValueOnce(outage);
    await expect(
      service.search(
        'actor',
        Object.assign(new SearchQueryDto(), {
          q: 'needle',
          type: 'cards',
          boardId: '11111111-1111-4111-8111-111111111111',
        }),
      ),
    ).rejects.toBe(outage);
    expect(searchCards).toHaveBeenCalledTimes(1);
  });
  it.each(['all', 'workspaces', 'boards', 'cards'] as const)(
    'never queries business data for empty input, type=%s',
    async (type) => {
      const response = await service.search(
        'actor',
        Object.assign(new SearchQueryDto(), { type }),
      );
      expect(response.query).toBe('');
      expect(response.type).toBe(type);
      expect(Object.values(response.groups)).toEqual(
        Array.from({ length: 3 }, () => ({
          items: [],
          total: 0,
          hasMore: false,
        })),
      );
      expect(manager.transaction).not.toHaveBeenCalled();
      expect(searchWorkspaces).not.toHaveBeenCalled();
      expect(searchBoards).not.toHaveBeenCalled();
      expect(searchCards).not.toHaveBeenCalled();
    },
  );
  it.each(['all', 'workspaces', 'boards', 'cards'] as const)(
    'queries only selected types in one repeatable-read snapshot: %s',
    async (type) => {
      const input = Object.assign(new SearchQueryDto(), { q: 'literal', type });
      const result = await service.search('actor', input);
      expect(manager.transaction).toHaveBeenCalledWith(
        'REPEATABLE READ',
        expect.any(Function),
      );
      for (const [name, fn, total] of [
        ['workspaces', searchWorkspaces, 1],
        ['boards', searchBoards, 2],
        ['cards', searchCards, 3],
      ] as const) {
        const selected = type === 'all' || type === name;
        expect(fn).toHaveBeenCalledTimes(selected ? 1 : 0);
        if (selected)
          expect(fn).toHaveBeenCalledWith(transaction, 'actor', input);
        expect(result.groups[name].total).toBe(selected ? total : 0);
      }
    },
  );
});
