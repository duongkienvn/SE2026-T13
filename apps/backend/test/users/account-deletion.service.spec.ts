import { DataSource, EntityManager } from 'typeorm';
import { AccountDeletionService } from '../../src/api/users/account-deletion/account-deletion.service';
import { User } from '../../src/api/users/entities/user.entity';
import { BoardRoomCoordinator } from '../../src/realtime/board-room-coordinator.service';
import { BoardEventPublisher } from '../../src/realtime/board-event-publisher.service';
import {
  deletionResources,
  DeletionResourcesChanged,
  requireDeletionEligible,
} from '../../src/api/users/account-deletion/account-deletion-locks';
import { eraseAccountPrivateState } from '../../src/api/users/account-deletion/account-deletion-state';
import { AccountDeletionBlockedException } from '../../src/api/users/account-deletion/account-deletion-blocked.exception';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));
jest.mock(
  '../../src/api/users/account-deletion/account-deletion-locks',
  () => ({
    deletionResources: jest.fn(),
    lockDeletionResources: jest.fn(),
    requireDeletionEligible: jest.fn(),
    DeletionResourcesChanged: class extends Error {},
  }),
);
jest.mock(
  '../../src/api/users/account-deletion/account-deletion-state',
  () => ({ eraseAccountPrivateState: jest.fn() }),
);

describe('Account deletion transaction lifecycle', () => {
  const resources = { boards: ['board'], workspaces: ['workspace'] };
  const proof = () => ({
    userId: 'user',
    email: 'private@example.test',
    authVersion: 2,
    expiresAt: Date.now() + 60000,
    passwordHash: 'snapshot',
  });
  function setup(patch: Partial<User> = {}) {
    const order: string[] = [];
    const user = {
      id: 'user',
      email: 'private@example.test',
      emailVerifiedAt: new Date(),
      authVersion: 2,
      passwordHash: 'snapshot',
      avatarRevision: 0,
      deletedAt: null,
      ...patch,
    };
    const users = {
      findOne: jest.fn().mockResolvedValue(user),
      update: jest.fn(async () => {
        order.push('update');
      }),
    };
    const manager = {
      query: jest.fn().mockResolvedValue([{ now: new Date() }]),
      getRepository: jest.fn((entity) =>
        entity === User
          ? users
          : { existsBy: jest.fn().mockResolvedValue(true) },
      ),
    };
    const source = {
      transaction: jest.fn(
        async (work: (manager: EntityManager) => Promise<unknown>) => {
          const result = await work(manager as unknown as EntityManager);
          order.push('commit');
          return result;
        },
      ),
    };
    const sessions = {
      withReadGrantChanges: jest.fn(async (work: () => Promise<unknown>) =>
        work(),
      ),
      revokeUserSessions: jest.fn(() => {
        order.push('revoke');
      }),
    };
    const events = {
      publish: jest.fn(async () => {
        order.push('publish');
      }),
    };
    const service = new AccountDeletionService(
      source as unknown as DataSource,
      sessions as unknown as BoardRoomCoordinator,
      events as unknown as BoardEventPublisher,
    );
    return { service, users, source, sessions, events, order };
  }
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(deletionResources).mockResolvedValue(resources);
    jest.mocked(requireDeletionEligible).mockResolvedValue();
    jest.mocked(eraseAccountPrivateState).mockResolvedValue();
  });
  it('commits identity before synchronous socket revocation and asynchronous publication', async () => {
    const h = setup();
    await h.service.delete(proof());
    expect(h.order).toEqual(['update', 'commit', 'revoke', 'publish']);
    expect(h.users.update).toHaveBeenCalledWith(
      'user',
      expect.objectContaining({
        email: 'deleted+user@users.invalid',
        displayName: 'Deleted user',
        authVersion: 3,
        deletedAt: expect.any(Date),
        passwordHash: null,
        avatarObjectKey: null,
        emailVerifiedAt: null,
      }),
    );
    expect(eraseAccountPrivateState).toHaveBeenCalledTimes(1);
  });
  it.each([
    { deletedAt: new Date() },
    { emailVerifiedAt: null },
    { authVersion: 3 },
    { email: 'changed@example.test' },
  ])('rejects revoked/changed identity before cleanup %#', async (patch) => {
    const h = setup(patch);
    await expect(h.service.delete(proof())).rejects.toMatchObject({
      status: 401,
    });
    expect(eraseAccountPrivateState).not.toHaveBeenCalled();
    expect(h.sessions.revokeUserSessions).not.toHaveBeenCalled();
  });
  it('rejects password changes without trusting a matching authVersion', async () => {
    const h = setup({ passwordHash: 'new-hash' });
    await expect(h.service.delete(proof())).rejects.toMatchObject({
      status: 403,
    });
    expect(eraseAccountPrivateState).not.toHaveBeenCalled();
  });
  it('rejects expired snapshots and empty or ambiguous proof shapes', async () => {
    const h = setup();
    await expect(
      h.service.delete({ ...proof(), expiresAt: 0 }),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      h.service.delete({ ...proof(), passwordHash: undefined }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      h.service.delete({ ...proof(), googleSub: 'subject' }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('reports blockers without cleanup, identity writes or revocation', async () => {
    const h = setup();
    jest.mocked(requireDeletionEligible).mockRejectedValue(
      new AccountDeletionBlockedException([
        {
          type: 'BOARD_REQUIRES_ANOTHER_OWNER',
          totalCount: 1,
          resources: [{ id: 'board', name: 'Board' }],
        },
      ]),
    );
    await expect(h.service.delete(proof())).rejects.toMatchObject({
      status: 409,
    });
    expect(h.users.update).not.toHaveBeenCalled();
    expect(eraseAccountPrivateState).not.toHaveBeenCalled();
    expect(h.sessions.revokeUserSessions).not.toHaveBeenCalled();
  });
  it('retries dependency-set changes from a new transaction and caps contention', async () => {
    const h = setup();
    jest
      .mocked(deletionResources)
      .mockResolvedValueOnce(resources)
      .mockResolvedValueOnce({ boards: [], workspaces: [] });
    await h.service.delete(proof());
    expect(h.source.transaction).toHaveBeenCalledTimes(2);
    expect(eraseAccountPrivateState).toHaveBeenCalledTimes(1);
    h.source.transaction.mockRejectedValue(new DeletionResourcesChanged());
    await expect(h.service.delete(proof())).rejects.toMatchObject({
      status: 409,
      response: { code: 'CONFLICT' },
    });
  });
  it('does not revoke or publish a failed transaction', async () => {
    const h = setup();
    jest
      .mocked(eraseAccountPrivateState)
      .mockRejectedValue(new Error('synthetic database error'));
    await expect(h.service.delete(proof())).rejects.toThrow(
      'synthetic database error',
    );
    expect(h.sessions.revokeUserSessions).not.toHaveBeenCalled();
    expect(h.events.publish).not.toHaveBeenCalled();
  });
  it('isolates failed post-commit realtime invalidation', async () => {
    const h = setup();
    h.events.publish.mockRejectedValue(new Error('adapter failed'));
    await expect(h.service.delete(proof())).resolves.toBeUndefined();
    expect(h.sessions.revokeUserSessions).toHaveBeenCalledWith('user', 3);
  });
});
