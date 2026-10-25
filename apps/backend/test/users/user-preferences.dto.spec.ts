import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateUserPreferencesDto } from '../../src/api/users/dto/update-user-preferences.dto';

describe('preference input boundary', () => {
  it.each(['UTC', 'Asia/Ho_Chi_Minh', 'America/New_York', 'Etc/GMT+7'])(
    'accepts the named timezone %s verbatim',
    async (timeZone) => {
      const input = plainToInstance(UpdateUserPreferencesDto, { timeZone });
      expect(await validate(input)).toEqual([]);
      expect(input.timeZone).toBe(timeZone);
    },
  );

  it.each([
    { theme: 'DARK' },
    { theme: '' },
    { theme: null },
    { theme: [] },
    { theme: {} },
    { theme: 1 },
    { timeZone: null },
    { timeZone: [] },
    { timeZone: {} },
    { timeZone: 12 },
    { timeZone: '' },
    { timeZone: 'Mars/Olympus' },
    { timeZone: 'not-a-zone' },
    { timeZone: '+07:00' },
    { timeZone: ' UTC ' },
    { timeZone: 'a'.repeat(101) },
    { dateFormat: 'yyyy-mm-dd' },
    { dateFormat: null },
    { weekStartsOn: 'Monday' },
    { weekStartsOn: null },
    { theme: 'dark', userId: 'another-account' },
  ])('rejects invalid input %j', async (body) => {
    const input = plainToInstance(UpdateUserPreferencesDto, body);
    expect(
      await validate(input, { whitelist: true, forbidNonWhitelisted: true }),
    ).not.toEqual([]);
  });

  it.each(['light', 'dark', 'system'])(
    'accepts theme %s with all other supported fields',
    async (theme) => {
      const input = plainToInstance(UpdateUserPreferencesDto, {
        theme,
        timeZone: 'UTC',
        dateFormat: 'DD/MM/YYYY',
        weekStartsOn: 'sunday',
      });
      expect(await validate(input)).toEqual([]);
    },
  );
});
