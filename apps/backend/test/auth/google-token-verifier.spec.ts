import { ConfigService } from '@nestjs/config';
import { generateKeyPairSync, sign } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { GoogleTokenVerifier } from '../../src/api/auth/google-token-verifier.service';
import { validateEnvironment } from '../../src/config/environment';

const audience = '123456-test.apps.googleusercontent.com';
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const wrongKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const now = Math.floor(Date.now() / 1000);
const claims = {
  sub: 'google-subject-123',
  aud: audience,
  iss: 'https://accounts.google.com',
  iat: now,
  exp: now + 3600,
  email: 'Ada@gmail.com',
  email_verified: true,
  name: 'Ada Lovelace',
  picture: 'https://lh3.googleusercontent.com/avatar',
};

function token(patch: Record<string, unknown> = {}, wrongSignature = false) {
  const header = Buffer.from(
    JSON.stringify({ alg: 'RS256', kid: 'test' }),
  ).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...claims, ...patch })).toString(
    'base64url',
  );
  const input = `${header}.${body}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), (wrongSignature ? wrongKeys : keys).privateKey).toString('base64url')}`;
}

describe('Google ID token verification through the official SDK', () => {
  let service: GoogleTokenVerifier;
  beforeEach(() => {
    jest
      .spyOn(OAuth2Client.prototype, 'getFederatedSignonCertsAsync')
      .mockResolvedValue({
        certs: {
          test: keys.publicKey
            .export({ type: 'spki', format: 'pem' })
            .toString(),
        },
        format: 'PEM',
      } as Awaited<ReturnType<OAuth2Client['getFederatedSignonCertsAsync']>>);
    service = new GoogleTokenVerifier(
      new ConfigService({ GOOGLE_CLIENT_ID: audience }),
    );
  });
  afterEach(() => jest.restoreAllMocks());

  it('verifies signature and claims, normalizes email and identifies authoritative Gmail', async () => {
    await expect(service.verify(token())).resolves.toMatchObject({
      sub: claims.sub,
      email: 'ada@gmail.com',
      authoritativeEmail: true,
      displayName: 'Ada Lovelace',
      avatarUrl: claims.picture,
    });
  });

  it.each([
    ['wrong audience', { aud: 'attacker.apps.googleusercontent.com' }],
    ['wrong issuer', { iss: 'https://attacker.test' }],
    ['expired within SDK clock skew', { exp: now - 30 }],
    ['long expired', { exp: now - 400 }],
    ['missing expiry', { exp: undefined }],
    ['future issued', { iat: now + 900 }],
    ['missing subject', { sub: undefined }],
    ['empty subject', { sub: '' }],
    ['oversized subject', { sub: 'a'.repeat(256) }],
    ['missing email', { email: undefined }],
    ['invalid email', { email: 'not-an-email' }],
    ['unverified email', { email_verified: false }],
    ['string verified claim', { email_verified: 'true' }],
  ])('rejects %s', async (_label, patch) => {
    await expect(service.verify(token(patch))).rejects.toMatchObject({
      status: 401,
      response: { code: 'INVALID_GOOGLE_CREDENTIAL' },
    });
  });

  it('rejects wrong signatures and malformed credentials without echoing tokens', async () => {
    for (const credential of [token({}, true), 'secret-invalid-jwt']) {
      const error = await service.verify(credential).catch((e: unknown) => e);
      expect(error).toMatchObject({
        status: 401,
        response: { code: 'INVALID_GOOGLE_CREDENTIAL' },
      });
      expect(JSON.stringify(error)).not.toContain(credential);
    }
  });

  it('requires verified hosted domain matching the email for Workspace authority', async () => {
    for (const [hd, authoritativeEmail] of [
      ['example.com', true],
      [undefined, false],
      ['other.com', false],
    ] as const) {
      await expect(
        service.verify(token({ email: 'ada@example.com', hd })),
      ).resolves.toMatchObject({ authoritativeEmail });
    }
  });

  it('caps untrusted names and rejects non-HTTPS or credential-bearing avatar URLs', async () => {
    for (const picture of [
      'javascript:alert(1)',
      'http://example.com/a',
      'https://user:pass@example.com/a',
      'x'.repeat(2049),
    ]) {
      const result = await service.verify(
        token({ picture, name: '\u0000' + 'a'.repeat(100) }),
      );
      expect(result.avatarUrl).toBeNull();
      expect(result.displayName).toBe('a'.repeat(80));
    }
  });

  it('fails closed when disabled or certificates cannot be fetched', async () => {
    const disabled = new GoogleTokenVerifier(
      new ConfigService({ GOOGLE_CLIENT_ID: '' }),
    );
    await expect(disabled.verify(token())).rejects.toMatchObject({
      status: 503,
      response: { code: 'GOOGLE_AUTH_UNAVAILABLE' },
    });
    jest
      .mocked(OAuth2Client.prototype.getFederatedSignonCertsAsync)
      .mockRejectedValue({ code: 'ETIMEDOUT' });
    await expect(service.verify(token())).rejects.toMatchObject({
      status: 503,
      response: { code: 'GOOGLE_AUTH_UNAVAILABLE' },
    });
  });
});

describe('Google client configuration', () => {
  const base = {
    NODE_ENV: 'test',
    JWT_SECRET: 'x'.repeat(32),
    DATABASE_HOST: 'localhost',
    DATABASE_PORT: '5432',
    DATABASE_NAME: 'test',
    DATABASE_USER: 'test',
    DATABASE_PASSWORD: 'test',
  };
  it('defaults to disabled and accepts a Web client ID', () => {
    expect(validateEnvironment(base).GOOGLE_CLIENT_ID).toBe('');
    expect(
      validateEnvironment({ ...base, GOOGLE_CLIENT_ID: audience })
        .GOOGLE_CLIENT_ID,
    ).toBe(audience);
  });
  it.each([
    'arbitrary',
    'https://example.com',
    ' client.apps.googleusercontent.com ',
    ['client'],
    123,
  ])('rejects malformed configuration %p', (value) => {
    expect(() =>
      validateEnvironment({ ...base, GOOGLE_CLIENT_ID: value }),
    ).toThrow('GOOGLE_CLIENT_ID');
  });
});
