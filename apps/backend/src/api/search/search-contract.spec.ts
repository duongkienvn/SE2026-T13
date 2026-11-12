import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SearchQueryDto } from './dto/search-query.dto';

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

});
