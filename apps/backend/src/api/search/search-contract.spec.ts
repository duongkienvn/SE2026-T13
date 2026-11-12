import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Repository } from 'typeorm';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { SearchQueryDto } from './dto/search-query.dto';
import { SearchService } from './search.service';

const boardId = '11111111-1111-4111-8111-111111111111';
const errorsFor = (query: Record<string, unknown>) =>
  validate(plainToInstance(SearchQueryDto, query));

describe('VT-053 search backward-compatible input contract', () => {
  it('accepts legacy search without boardId (no new required parameter)', async () => {
    expect(await errorsFor({ q: 'needle', type: 'cards', page: '1' })).toEqual([]);
  });

  it('accepts boardId only when type=cards', async () => {
    expect(await errorsFor({ q: 'needle', type: 'cards', boardId })).toEqual([]);
    for (const type of ['all', 'boards', 'workspaces']) {
      expect(
        (await errorsFor({ q: 'needle', type, boardId })).some(
          (error) => error.property === 'boardId',
        ),
      ).toBe(true);
    }
  });

  it('rejects malformed board scope instead of silently ignoring it', async () => {
    for (const invalid of ['not-a-uuid', '', '11111111-1111-1111-1111-111111111111']) {
      expect(
        (await errorsFor({ q: 'needle', type: 'cards', boardId: invalid })).some(
          (error) => error.property === 'boardId',
        ),
      ).toBe(true);
    }
  });

  it('propagates backend errors: never returns a plausible empty result', async () => {
    const outage = new Error('VT053_DATABASE_OUTAGE');
    const transaction = jest.fn().mockRejectedValue(outage);
    const repository = { manager: { transaction } } as unknown as Repository<Workspace>;
    const service = new SearchService(repository);
    await expect(
      service.search('11111111-1111-4111-8111-111111111111', {
        q: 'needle',
        type: 'cards',
      } as SearchQueryDto),
    ).rejects.toBe(outage);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
