import { CreateCardDto } from '../../src/api/cards/dto/create-card.dto';
import { UpdateCardDto } from '../../src/api/cards/dto/update-card.dto';
import { createValidationPipe } from '../../src/config/validation';
const pipe = createValidationPipe();
const validate = (type: new () => object, input: unknown) =>
  pipe.transform(input, { type: 'body', metatype: type });
const columnId = 'c6ba7134-97ef-4c1b-a342-001a982a7721';

describe('Card instant DTOs', () => {
  it.each([
    '2026-03-08T01:30:00-05:00',
    '2026-03-08T03:30:00-04:00',
    '2026-11-01T01:30:00-05:00',
    '2024-02-29T00:00:00Z',
    '2026-01-01T00:00Z',
    '2026-01-01T00:00:00.123456Z',
    null,
  ])('accepts explicit start/due instants and null: %p', async (date) => {
    for (const type of [CreateCardDto, UpdateCardDto])
      await expect(
        validate(type, {
          ...(type === CreateCardDto ? { columnId, title: 'Date' } : {}),
          startDate: date,
          dueDate: date,
        }),
      ).resolves.toMatchObject({ startDate: date, dueDate: date });
  });
  it.each([
    '2026-01-01',
    '2026-01-01T02:00:00',
    '2026-02-30T00:00Z',
    '2026-01-01T24:00Z',
    '2026-01-01T00:00+24:00',
    '2026-01-01T00:00-12:60',
    '2026-01-01T00:00:60Z',
    '0000-01-01T00:00Z',
    '0001-01-01T00:00+00:01',
    Infinity,
    123,
    {},
    [],
  ])('rejects invalid start and due representations: %p', async (date) => {
    for (const field of ['startDate', 'dueDate'])
      await expect(
        validate(UpdateCardDto, { [field]: date }),
      ).rejects.toMatchObject({ status: 400 });
  });
  it('preserves omission and rejects unsupported civil precision, status and timezone fields', async () => {
    expect(
      (
        (await validate(UpdateCardDto, {
          title: 'Only title',
        })) as UpdateCardDto
      ).startDate,
    ).toBeUndefined();
    for (const input of [
      { startDateOnly: '2026-03-08' },
      { dueDate: '2026-03-08', timeZone: 'America/New_York' },
      { isAllDay: true },
      { dueStatus: 'OVERDUE' },
    ])
      await expect(validate(UpdateCardDto, input)).rejects.toMatchObject({
        status: 400,
      });
  });
});
