import { validatePushEnvironment } from '../../src/api/push/push.config';
import { PushTokenCipher, validExpoToken } from '../../src/api/push/push-token';

const settings = () => ({
  PUSH_NOTIFICATIONS_ENABLED: 'true',
  PUSH_PROJECT_ID: '45269d99-0d21-44b6-ab8f-e73e80576fee',
  PUSH_APP_ENVIRONMENT: 'development',
  PUSH_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
});
describe('push configuration and routing-material protection', () => {
  it('defaults off without requiring provider credentials', () => {
    expect(validatePushEnvironment({}).PUSH_NOTIFICATIONS_ENABLED).toBe(false);
  });
  it.each([
    'PUSH_TOKEN_ENCRYPTION_KEY',
    'PUSH_PROJECT_ID',
    'PUSH_APP_ENVIRONMENT',
  ])('fails closed when enabled with invalid %s', (key) => {
    expect(() =>
      validatePushEnvironment({ ...settings(), [key]: 'bad-secret-value' }),
    ).toThrow();
    try {
      validatePushEnvironment({ ...settings(), [key]: 'bad-secret-value' });
    } catch (error) {
      expect(String(error)).not.toContain('bad-secret-value');
    }
  });
  it('validates flags strictly and rejects header injection', () => {
    expect(() =>
      validatePushEnvironment({ PUSH_NOTIFICATIONS_ENABLED: 'yes' }),
    ).toThrow();
    expect(() =>
      validatePushEnvironment({
        ...settings(),
        EXPO_PUSH_ACCESS_TOKEN: 'key\r\nsecret',
      }),
    ).toThrow();
  });
  it('accepts only bounded Expo routing tokens', () => {
    expect(validExpoToken('ExpoPushToken[abcdefghijklmnopqrstuvwxyz]')).toBe(
      true,
    );
    expect(
      validExpoToken('ExponentPushToken[abcdefghijklmnopqrstuvwxyz]'),
    ).toBe(true);
    for (const token of [
      'native-fcm-token',
      '',
      'ExpoPushToken[]',
      'ExpoPushToken[' + 'x'.repeat(300) + ']',
      'ExpoPushToken[secret]\n',
    ])
      expect(validExpoToken(token)).toBe(false);
  });
  it('encrypts with random IVs and authenticated context, fingerprints without retaining plaintext', () => {
    const cipher = new PushTokenCipher(settings().PUSH_TOKEN_ENCRYPTION_KEY);
    const token = 'ExpoPushToken[abcdefghijklmnopqrstuvwxyz]';
    const encrypted = cipher.encrypt(token, 'installation');
    expect(encrypted).not.toContain(token);
    expect(cipher.encrypt(token, 'installation')).not.toBe(encrypted);
    expect(cipher.decrypt(encrypted, 'installation')).toBe(token);
    expect(() => cipher.decrypt(encrypted, 'other-installation')).toThrow(
      'Invalid encrypted push token',
    );
    expect(cipher.fingerprint(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(cipher.fingerprint(token)).toBe(cipher.fingerprint(token));
    expect(
      cipher.fingerprint(token.replace('ExpoPushToken', 'ExponentPushToken')),
    ).toBe(cipher.fingerprint(token));
    expect(
      new PushTokenCipher(Buffer.alloc(32, 8).toString('base64')).fingerprint(
        token,
      ),
    ).not.toBe(cipher.fingerprint(token));
  });
});
