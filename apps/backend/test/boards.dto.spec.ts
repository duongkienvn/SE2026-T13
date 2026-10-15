import { ParseUUIDPipe } from '@nestjs/common';
import { CreateBoardDto } from '../src/api/boards/dto/create-board.dto';
import { UpdateBoardDto } from '../src/api/boards/dto/update-board.dto';
import { createValidationPipe } from '../src/config/validation';

describe('board request validation', () => {
  const pipe = createValidationPipe();
  const validate = (
    metatype: typeof CreateBoardDto | typeof UpdateBoardDto,
    value: unknown,
  ) => pipe.transform(value, { type: 'body', metatype });

  it('trims names and preserves absent, null and empty descriptions', async () => {
    expect(await validate(CreateBoardDto, { name: ' Board ' })).toEqual({
      name: 'Board',
    });
    for (const description of [null, '', ' description ']) {
      expect(
        await validate(CreateBoardDto, { name: 'Board', description }),
      ).toEqual({ name: 'Board', description });
      expect(await validate(UpdateBoardDto, { description })).toEqual({
        description,
      });
    }
  });

  it.each([undefined, null, '', '   ', 1, [], {}, 'x'.repeat(121)])(
    'rejects invalid create name %p',
    async (name) => {
      await expect(validate(CreateBoardDto, { name })).rejects.toMatchObject({
        status: 400,
      });
    },
  );

  it.each([null, '', '   ', 1, 'x'.repeat(121)])(
    'rejects invalid update name %p',
    async (name) => {
      await expect(validate(UpdateBoardDto, { name })).rejects.toMatchObject({
        status: 400,
      });
    },
  );

  it.each([CreateBoardDto, UpdateBoardDto])(
    'enforces boundaries and description types for %p',
    async (type) => {
      await expect(
        validate(type, {
          name: 'x'.repeat(120),
          description: 'x'.repeat(2000),
        }),
      ).resolves.toBeDefined();
      for (const description of [false, 1, [], {}, 'x'.repeat(2001)]) {
        await expect(
          validate(type, { name: 'Board', description }),
        ).rejects.toMatchObject({ status: 400 });
      }
    },
  );

  it.each([
    'createdById',
    'isArchived',
    'archivedAt',
    'createdAt',
    'updatedAt',
    'members',
    'currentUserRole',
  ])('rejects privileged or unknown field %s', async (field) => {
    for (const type of [CreateBoardDto, UpdateBoardDto]) {
      await expect(
        validate(type, { name: 'Board', [field]: 'spoofed' }),
      ).rejects.toMatchObject({ status: 400 });
    }
  });

  it('rejects invalid path UUIDs', async () => {
    const uuid = new ParseUUIDPipe();
    await expect(
      uuid.transform('invalid', { type: 'param' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      uuid.transform('1c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5', { type: 'param' }),
    ).resolves.toBeDefined();
  });
});
