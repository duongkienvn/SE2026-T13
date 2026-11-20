import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  RegisterPushDeviceDto,
  UpdatePushPreferencesDto,
} from '../../src/api/push/push.dto';

describe('push registry input boundary', () => {
  const strict = { whitelist: true, forbidNonWhitelisted: true };
  it.each([
    {},
    { enabled: null },
    { enabled: 'true' },
    { enabled: true, userId: 'other' },
  ])('rejects invalid preference %j', async (body) => {
    expect(
      await validate(plainToInstance(UpdatePushPreferencesDto, body), strict),
    ).not.toHaveLength(0);
  });
  it('accepts only a complete native Expo enrollment', async () => {
    const valid = {
      installationId: '14f2550e-9359-4c06-a642-6257cb384b53',
      projectId: '45269d99-0d21-44b6-ab8f-e73e80576fee',
      expoPushToken: 'ExpoPushToken[abcdefghijklmnop]',
      platform: 'android',
      appEnvironment: 'development',
    };
    expect(
      await validate(plainToInstance(RegisterPushDeviceDto, valid), strict),
    ).toHaveLength(0);
    for (const patch of [
      { expoPushToken: 'fcm-token' },
      { platform: 'web' },
      { userId: 'other' },
      { expoPushToken: 'x'.repeat(500) },
    ]) {
      expect(
        await validate(
          plainToInstance(RegisterPushDeviceDto, { ...valid, ...patch }),
          strict,
        ),
      ).not.toHaveLength(0);
    }
  });
});
