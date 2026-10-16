import { CreateCardDto } from '../src/api/cards/dto/create-card.dto';
import { UpdateCardDto } from '../src/api/cards/dto/update-card.dto';
import { MoveCardDto } from '../src/api/cards/dto/move-card.dto';
import { ListCardsDto } from '../src/api/cards/dto/list-cards.dto';
import { AssignCardDto } from '../src/api/cards/dto/assign-card.dto';
import { toCardResponseDto } from '../src/api/cards/dto/card-response.dto';
import { Card } from '../src/api/cards/entities/card.entity';
import { createValidationPipe } from '../src/config/validation';

const ID = 'c6ba7134-97ef-4c1b-a342-001a982a7721';
const pipe = createValidationPipe();
const validate = (type: new () => object, value: unknown) =>
  pipe.transform(value, { type: 'body', metatype: type });

describe('Card DTO contracts', () => {
  it('trims title and distinguishes omitted, null and empty values', async () => {
    const created = await validate(CreateCardDto, {
      columnId: ID,
      title: ' Card ',
      dueDate: '2000-01-01T00:00:00Z',
    });
    expect(created).toMatchObject({
      title: 'Card',
      dueDate: '2000-01-01T00:00:00Z',
    });
    for (const description of [null, '', 'text']) {
      await expect(
        validate(UpdateCardDto, { description, dueDate: null }),
      ).resolves.toMatchObject({ description, dueDate: null });
    }
    await expect(
      validate(CreateCardDto, {
        columnId: ID,
        title: 'x'.repeat(120),
        description: 'x'.repeat(2000),
      }),
    ).resolves.toBeDefined();
  });
  it.each([null, '', ' ', 1, 'x'.repeat(121)])(
    'rejects invalid title %p',
    async (title) => {
      for (const type of [CreateCardDto, UpdateCardDto]) {
        await expect(
          validate(type, {
            ...(type === CreateCardDto ? { columnId: ID } : {}),
            title,
          }),
        ).rejects.toMatchObject({ status: 400 });
      }
    },
  );
  it.each([
    '2026-10-01',
    '2026-10-01T10:00:00',
    '2026-02-30T00:00:00Z',
    'bad',
    12,
  ])('rejects invalid deadline %p', async (dueDate) => {
    await expect(validate(UpdateCardDto, { dueDate })).rejects.toMatchObject({
      status: 400,
    });
  });
  it.each(['boardId', 'createdById', 'position', 'isArchived', 'columnId'])(
    'rejects controlled fields in PATCH: %s',
    async (field) => {
      await expect(
        validate(UpdateCardDto, { [field]: ID }),
      ).rejects.toMatchObject({ status: 400 });
    },
  );
  it('requires nullable anchor, validates UUIDs, bounds pagination and text', async () => {
    await expect(
      validate(MoveCardDto, { toColumnId: ID, beforeCardId: null }),
    ).resolves.toBeDefined();
    for (const value of [
      { toColumnId: ID },
      { toColumnId: null, beforeCardId: null },
      { toColumnId: ID, beforeCardId: 'bad' },
    ]) {
      await expect(validate(MoveCardDto, value)).rejects.toMatchObject({
        status: 400,
      });
    }
    await expect(
      validate(AssignCardDto, { userId: 'bad' }),
    ).rejects.toMatchObject({ status: 400 });
    for (const value of [
      { columnId: null },
      { columnId: 'bad' },
      { limit: 101 },
      { page: 0 },
    ]) {
      await expect(validate(ListCardsDto, value)).rejects.toMatchObject({
        status: 400,
      });
    }
    await expect(
      validate(UpdateCardDto, { description: 'x'.repeat(2001) }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('maps dates to UTC and whitelists nested public data', () => {
    const date = new Date('2026-10-16T10:00:00+07:00');
    const card = Object.assign(new Card(), {
      id: ID,
      createdAt: date,
      updatedAt: date,
      dueDate: date,
      archivedAt: null,
      assignees: [
        {
          userId: ID,
          assignedById: null,
          createdAt: date,
          user: { passwordHash: 'secret' },
        },
      ],
      comments: [{ content: 'private' }],
    });
    const dto = toCardResponseDto(card);
    expect(dto.dueDate).toBe('2026-10-16T03:00:00.000Z');
    expect(dto.assignees[0]).toEqual({
      userId: ID,
      assignedById: null,
      createdAt: '2026-10-16T03:00:00.000Z',
    });
    expect(dto).not.toHaveProperty('comments');
  });
});
