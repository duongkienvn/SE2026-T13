import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateWorkspaceDto,
  UpdateWorkspaceDto,
} from '../../src/api/workspaces/dto/workspace-input.dto';
import { WorkspaceBoardsQueryDto } from '../../src/api/workspaces/dto/workspace-boards-query.dto';
import { CreateBoardDto } from '../../src/api/boards/dto/create-board.dto';
import { WorkspacePageQueryDto } from '../../src/api/workspaces/dto/workspace-page-query.dto';

describe('Workspace API validation', () => {
  describe.each([
    ['WorkspacePageQueryDto', WorkspacePageQueryDto],
    ['WorkspaceBoardsQueryDto', WorkspaceBoardsQueryDto],
  ] as const)('%s page validation', (_name, queryType) => {
    it.each(['0', '-1', '1.5', 0, -1, 1.5, '1000001', 1000001])(
      'rejects invalid page %p',
      async (page) => {
        const errors = await validate(plainToInstance(queryType, { page }));
        expect(errors.map((error) => error.property)).toContain('page');
      },
    );

    it.each(['1', 1, '1000000', 1000000])(
      'accepts page within bounds %p',
      async (page) => {
        expect(await validate(plainToInstance(queryType, { page }))).toEqual(
          [],
        );
      },
    );
  });

  it('trims metadata and accepts only supported nullable icon keys', async () => {
    const input = plainToInstance(CreateWorkspaceDto, {
      name: ' Team ',
      description: ' text ',
      icon: 'users',
    });
    expect(await validate(input)).toEqual([]);
    expect(input.name).toBe('Team');
    expect(input.description).toBe('text');
    for (const value of [
      { name: ' ' },
      { name: null },
      { name: 'a'.repeat(121) },
      { name: 'Team', icon: 'https://example.test/icon' },
      { name: 'Team', description: 'a'.repeat(2001) },
    ]) {
      expect(
        (await validate(plainToInstance(CreateWorkspaceDto, value))).length,
      ).toBeGreaterThan(0);
    }
    expect(
      await validate(
        plainToInstance(UpdateWorkspaceDto, { icon: null, description: null }),
      ),
    ).toEqual([]);
  });

  it('bounds paging and rejects unsupported status, sort and null search', async () => {
    expect(
      await validate(
        plainToInstance(WorkspaceBoardsQueryDto, {
          page: '2',
          limit: '5',
          search: ' foo ',
          status: 'archived',
          sort: 'updatedAt',
        }),
      ),
    ).toEqual([]);
    for (const value of [
      { limit: '101' },
      { page: '0' },
      { sort: 'name; DROP TABLE boards' },
      { status: 'all' },
      { search: null },
      { search: 'a'.repeat(121) },
    ]) {
      expect(
        (await validate(plainToInstance(WorkspaceBoardsQueryDto, value)))
          .length,
      ).toBeGreaterThan(0);
    }
  });

  it('preserves legacy Board input and validates explicit Workspace IDs', async () => {
    expect(
      await validate(plainToInstance(CreateBoardDto, { name: 'Legacy' })),
    ).toEqual([]);
    for (const workspaceId of [null, '', 'not-a-uuid']) {
      expect(
        (
          await validate(
            plainToInstance(CreateBoardDto, { name: 'Board', workspaceId }),
          )
        ).length,
      ).toBeGreaterThan(0);
    }
  });
});
