import { Inject } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UsersService } from '../../src/api/users/users.service';
import { User } from '../../src/api/users/entities/user.entity';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => Inject('UserRepository'),
}));

const USER_ID = '1c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5';

function userFixture(): User {
  return Object.assign(new User(), {
    id: USER_ID,
    email: 'ada@example.com',
    passwordHash: 'secret-hash',
    displayName: 'Ada Lovelace',
    avatarUrl: null,
    createdAt: new Date('2026-10-12T00:00:00.000Z'),
    updatedAt: new Date('2026-10-12T00:00:00.000Z'),
  });
}

describe('UsersService', () => {
  it('updates only the authenticated user profile and excludes sensitive fields', async () => {
    const user = userFixture();
    const repository = {
      findOne: jest.fn().mockResolvedValue(user),
      update: jest.fn().mockImplementation((_id, patch) => {
        Object.assign(user, patch);
        return Promise.resolve({ affected: 1 });
      }),
    };
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: 'UserRepository', useValue: repository },
      ],
    }).compile();
    const service = module.get(UsersService);

    const result = await service.updateCurrentUser(USER_ID, {
      displayName: 'Grace Hopper',
      avatarUrl: null,
    });

    expect(repository.findOne).toHaveBeenCalledWith({ where: { id: USER_ID } });
    expect(result.displayName).toBe('Grace Hopper');
    expect(result.avatarUrl).toBeNull();
    expect(result).not.toHaveProperty('passwordHash');
    expect(repository.update).toHaveBeenCalledWith(USER_ID, {
      displayName: 'Grace Hopper',
      avatarUrl: null,
    });
  });

  it('rejects an empty profile patch', async () => {
    const repository = { findOne: jest.fn(), save: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: 'UserRepository', useValue: repository },
      ],
    }).compile();
    const service = module.get(UsersService);

    await expect(service.updateCurrentUser(USER_ID, {})).rejects.toMatchObject({
      status: 400,
      response: { code: 'VALIDATION_FAILED' },
    });
    expect(repository.findOne).not.toHaveBeenCalled();
  });
});
