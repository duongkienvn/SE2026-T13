import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';

export const validExpoToken = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 256 &&
  /^(ExpoPushToken|ExponentPushToken)\[[A-Za-z0-9_-]{16,220}\]$/.test(value);
/** v1 key rotation requires revoking/removing old enrollments before re-enrollment. */
export class PushTokenCipher {
  private readonly key: Buffer;
  private readonly fingerprintKey: Buffer;
  constructor(key: string) {
    this.key = Buffer.from(key, 'base64');
    if (this.key.length !== 32)
      throw new Error('Push encryption is unavailable');
    this.fingerprintKey = createHmac('sha256', this.key)
      .update('kanvexa/push/fingerprint/v1')
      .digest();
  }
  fingerprint(token: string) {
    return createHmac('sha256', this.fingerprintKey)
      .update(token.replace(/^ExponentPushToken/, 'ExpoPushToken'))
      .digest('hex');
  }
  encrypt(token: string, context: string): string {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const encrypted = Buffer.concat([
      cipher.update(token, 'utf8'),
      cipher.final(),
    ]);
    return [
      'v1',
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      encrypted.toString('base64'),
    ].join('.');
  }
  decrypt(value: string, context: string): string {
    try {
      const [version, iv, tag, data, extra] = value.split('.');
      if (version !== 'v1' || extra !== undefined || !iv || !tag || !data)
        throw new Error();
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.key,
        Buffer.from(iv, 'base64'),
      );
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      const token = Buffer.concat([
        decipher.update(Buffer.from(data, 'base64')),
        decipher.final(),
      ]).toString('utf8');
      if (!validExpoToken(token)) throw new Error();
      return token;
    } catch {
      throw new Error('Invalid encrypted push token');
    }
  }
}
