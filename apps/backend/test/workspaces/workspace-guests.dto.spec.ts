import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  toWorkspaceGuestDto,
  WorkspaceGuestsQueryDto,
} from '../../src/api/workspaces/dto/workspace-guests.dto';
import { BoardMemberRole } from '../../src/common/enums/database-enums';

describe('Workspace Guests contract', () => {
  it('defaults and bounds pagination, trims display-name search', async () => {
    expect(new WorkspaceGuestsQueryDto()).toMatchObject({ page: 1, limit: 20 });
    const input = plainToInstance(WorkspaceGuestsQueryDto, {
      page: '1000000',
      limit: '100',
      search: '  literal %_\\  ',
    });
    expect(await validate(input)).toEqual([]);
    expect(input.search).toBe('literal %_\\');
  });

  it.each([
    { page: '0' },
    { page: '1.5' },
    { page: '1000001' },
    { limit: '0' },
    { limit: '101' },
    { limit: '1.5' },
    { search: null },
    { search: ['name'] },
    { search: 'a'.repeat(121) },
    { sort: 'email' },
    { role: 'GUEST' },
    { status: 'active' },
  ])('rejects invalid or unsupported input %p', async (input) => {
    expect(
      (
        await validate(plainToInstance(WorkspaceGuestsQueryDto, input), {
          whitelist: true,
          forbidNonWhitelisted: true,
        })
      ).length,
    ).toBeGreaterThan(0);
  });

  it('allowlists nested identities and associations and projects private avatars', () => {
    const user = {
      id: 'user-id',
      displayName: 'Guest',
      avatarUrl: 'https://example.test/old',
      avatarObjectKey: 'avatars/active/user-id/object-id.webp',
      email: 'private@example.test',
      passwordHash: 'secret',
      authVersion: 4,
    };
    const board = {
      boardId: 'board-id',
      name: 'Permitted',
      role: BoardMemberRole.OWNER,
      isArchived: true,
      workspaceId: 'hidden',
      createdById: 'hidden',
    };
    expect(
      JSON.parse(JSON.stringify(toWorkspaceGuestDto(user, [board]))),
    ).toEqual({
      user: {
        id: 'user-id',
        displayName: 'Guest',
        avatarUrl: '/users/user-id/avatar/object-id',
      },
      boards: [
        {
          boardId: 'board-id',
          name: 'Permitted',
          role: 'OWNER',
          isArchived: true,
        },
      ],
      visibleBoardCount: 1,
    });
    expect(
      toWorkspaceGuestDto({ ...user, avatarObjectKey: null }, [board]).user
        .avatarUrl,
    ).toBe(user.avatarUrl);
    expect(
      toWorkspaceGuestDto({ ...user, avatarObjectKey: null, avatarUrl: null }, [
        board,
      ]).user.avatarUrl,
    ).toBeNull();
  });
});
