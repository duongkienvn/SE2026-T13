import { BoardDiscoveryService } from '../../src/api/boards/board-discovery.service';
import { BOARD_BACKGROUNDS } from '../../src/api/boards/board-backgrounds';
import { Board } from '../../src/api/boards/entities/board.entity';
import { Workspace } from '../../src/api/workspaces/entities/workspace.entity';
import { BoardMemberRole } from '../../src/common/enums/database-enums';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: (entity: { name: string }) =>
    (
      jest.requireActual('@nestjs/common') as typeof import('@nestjs/common')
    ).Inject(`${entity.name}Repository`),
}));

describe('board discovery background', () => {
  const board = Object.assign(new Board(), {
    id: 'board',
    workspaceId: 'workspace',
    backgroundPreset: 'blue',
    name: 'Board',
    description: null,
    createdById: 'owner',
    isArchived: false,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const save = jest.fn(async () => board);
  const manager = {
    getRepository: jest.fn((entity: unknown) =>
      entity === Workspace ? { findOneByOrFail: async () => ({}) } : { save },
    ),
  };
  const transaction = jest.fn(
    async (callback: (value: typeof manager) => unknown) => callback(manager),
  );
  const authorization = {
    requireMutableOwner: jest.fn(async () => ({
      board,
      member: { role: BoardMemberRole.OWNER },
    })),
  };
  const events = { publish: jest.fn() };
  const activities = { record: jest.fn() };
  const service = new BoardDiscoveryService(
    { manager: { transaction } } as never,
    authorization as never,
    events as never,
    activities as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    board.backgroundPreset = 'blue';
  });

  it('provides eight colors and four distinct photographic presets', () => {
    expect(
      BOARD_BACKGROUNDS.filter((item) => item.kind === 'color'),
    ).toHaveLength(8);
    const photos = BOARD_BACKGROUNDS.filter((item) => item.kind === 'photo');
    expect(photos).toHaveLength(4);
    expect(new Set(BOARD_BACKGROUNDS.map((item) => item.id)).size).toBe(12);
    expect(
      photos.every((item) =>
        item.value.startsWith('https://images.unsplash.com/'),
      ),
    ).toBe(true);
  });

  it.each(['teal', 'forest'])(
    'persists %s and publishes only after commit',
    async (preset) => {
      const result = await service.background('owner', 'board', preset);
      expect(result.backgroundPreset).toBe(preset);
      expect(save).toHaveBeenCalledTimes(1);
      expect(events.publish).toHaveBeenCalledWith('board:access-changed', {
        boardId: 'board',
      });
      expect(transaction.mock.invocationCallOrder[0]).toBeLessThan(
        events.publish.mock.invocationCallOrder[0],
      );
    },
  );

  it('rejects unknown values and propagates authorization failures without an event', async () => {
    await expect(
      service.background('owner', 'board', 'https://evil.test/a'),
    ).rejects.toMatchObject({ status: 400 });
    authorization.requireMutableOwner.mockRejectedValueOnce(
      Object.assign(new Error(), { status: 404 }),
    );
    await expect(
      service.background('owner', 'board', 'forest'),
    ).rejects.toMatchObject({ status: 404 });
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('does not publish when the transaction audit fails', async () => {
    activities.record.mockRejectedValueOnce(new Error('audit failed'));
    await expect(
      service.background('owner', 'board', 'forest'),
    ).rejects.toThrow('audit failed');
    expect(events.publish).not.toHaveBeenCalled();
  });
});
