import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Resend } from 'resend';
import { validateEnvironment } from '../../src/config/environment';
import { MailModule } from '../../src/mail/mail.module';
import { ResendVerificationMailer } from '../../src/mail/resend-verification-mailer';
import {
  FakeWelcomeMailer,
  WelcomeMailer,
} from '../../src/mail/welcome-mailer';
import { ResendWelcomeMailer } from '../../src/mail/resend-welcome-mailer';
import {
  PasswordRecoveryMailer,
  FakePasswordRecoveryMailer,
} from '../../src/mail/password-recovery-mailer';
import { ResendPasswordRecoveryMailer } from '../../src/mail/resend-password-recovery-mailer';
import {
  FakeVerificationMailer,
  VerificationMailer,
} from '../../src/mail/verification-mailer';

// All credentials below are synthetic; provider construction/delivery is mocked.
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: {
      send: jest
        .fn()
        .mockResolvedValue({ data: { id: 'mock-accepted' }, error: null }),
    },
  })),
}));

const base = {
  NODE_ENV: 'development',
  JWT_SECRET: 'configuration-only-at-least-32-bytes',
  DATABASE_HOST: 'localhost',
  DATABASE_PORT: '5432',
  DATABASE_NAME: 'test',
  DATABASE_USER: 'test',
  DATABASE_PASSWORD: 'test',
};
const mail = {
  RESEND_API_KEY: 're_synthetic_configuration_only',
  MAIL_FROM: 'Kanvexa <no-reply@kanvexa.tech>',
  PUBLIC_APP_URL: 'http://localhost:5173',
};

describe('mail transport configuration', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['development', undefined, 'fake'],
    ['development', 'fake', 'fake'],
    ['development', 'resend', 'resend'],
    ['test', undefined, 'fake'],
    ['test', 'fake', 'fake'],
    ['test', 'resend', 'fake'],
    ['production', undefined, 'resend'],
    ['production', 'resend', 'resend'],
  ])(
    'selects the real Nest provider for %s / %s as %s',
    async (NODE_ENV, MAIL_TRANSPORT, expected) => {
      const config = validateEnvironment({
        ...base,
        ...mail,
        NODE_ENV,
        MAIL_TRANSPORT,
        CORS_ORIGINS: 'https://kanvexa.tech',
        PUBLIC_APP_URL:
          NODE_ENV === 'production'
            ? 'https://kanvexa.tech'
            : mail.PUBLIC_APP_URL,
      });
      expect(config.MAIL_TRANSPORT).toBe(expected);
      const module = await Test.createTestingModule({ imports: [MailModule] })
        .overrideProvider(ConfigService)
        .useValue(new ConfigService(config))
        .compile();
      try {
        const adapter = module.get(VerificationMailer);
        expect(adapter).toBeInstanceOf(
          expected === 'resend'
            ? ResendVerificationMailer
            : FakeVerificationMailer,
        );
        await adapter.send(
          'recipient@example.test',
          'http://localhost:5173/verify-email',
          'mock-request',
        );
        expect(module.get(PasswordRecoveryMailer)).toBeInstanceOf(
          expected === 'fake'
            ? FakePasswordRecoveryMailer
            : ResendPasswordRecoveryMailer,
        );
        expect(module.get(WelcomeMailer)).toBeInstanceOf(
          NODE_ENV === 'production' ? ResendWelcomeMailer : FakeWelcomeMailer,
        );
        expect(Resend).toHaveBeenCalledTimes(
          expected === 'resend' ? (NODE_ENV === 'production' ? 3 : 2) : 0,
        );
        if (expected === 'fake') expect(config.RESEND_API_KEY).toBe('');
        else expect(config.RESEND_API_KEY === mail.RESEND_API_KEY).toBe(true);
      } finally {
        await module.close();
      }
    },
  );

  it('rejects fake transport in production', () => {
    expect(() =>
      validateEnvironment({
        ...base,
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://kanvexa.tech',
        MAIL_TRANSPORT: 'fake',
      }),
    ).toThrow('MAIL_TRANSPORT must be resend in production');
  });

  it.each(['smtp', '', null, true])(
    'rejects invalid transport %s',
    (MAIL_TRANSPORT) => {
      expect(() => validateEnvironment({ ...base, MAIL_TRANSPORT })).toThrow(
        'MAIL_TRANSPORT must be fake or resend',
      );
    },
  );

  describe.each(['development', 'production'])(
    'Resend validation in %s',
    (NODE_ENV) => {
      const resend = {
        ...base,
        ...mail,
        NODE_ENV,
        MAIL_TRANSPORT: 'resend',
        CORS_ORIGINS: 'https://kanvexa.tech',
        PUBLIC_APP_URL: 'https://kanvexa.tech',
      };
      it.each(['RESEND_API_KEY', 'MAIL_FROM', 'PUBLIC_APP_URL'])(
        'requires %s',
        (key) => {
          expect(() =>
            validateEnvironment({ ...resend, [key]: undefined }),
          ).toThrow(key);
          expect(() => validateEnvironment({ ...resend, [key]: '' })).toThrow(
            key,
          );
        },
      );
      it.each([
        ['RESEND_API_KEY', 'invalid'],
        ['MAIL_FROM', 'not-an-email'],
        ['MAIL_FROM', 'Kanvexa <no-reply@kanvexa.tech>\r\nInjected: value'],
        ['PUBLIC_APP_URL', 'http://remote.example.test'],
        ['PUBLIC_APP_URL', 'https://kanvexa.tech/verify-email'],
        ['PUBLIC_APP_URL', 'https://kanvexa.tech?token=placeholder'],
        ['PUBLIC_APP_URL', 'https://kanvexa.tech#fragment'],
        ['PUBLIC_APP_URL', 'https://user:password@kanvexa.tech'],
      ])('rejects malformed %s', (key, value) => {
        expect(() => validateEnvironment({ ...resend, [key]: value })).toThrow(
          key,
        );
      });
    },
  );

  it('permits local HTTP links only outside production', () => {
    const input = { ...base, ...mail, MAIL_TRANSPORT: 'resend' };
    expect(validateEnvironment(input).PUBLIC_APP_URL).toBe(mail.PUBLIC_APP_URL);
    expect(() =>
      validateEnvironment({
        ...input,
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://kanvexa.tech',
      }),
    ).toThrow('PUBLIC_APP_URL');
  });

  it('keeps default development and all test processes fake without mail credentials', () => {
    expect(validateEnvironment(base).MAIL_TRANSPORT).toBe('fake');
    expect(
      validateEnvironment({ ...base, NODE_ENV: undefined }).MAIL_TRANSPORT,
    ).toBe('fake');
    expect(
      validateEnvironment({
        ...base,
        NODE_ENV: 'test',
        MAIL_TRANSPORT: 'resend',
      }).MAIL_TRANSPORT,
    ).toBe('fake');
  });
});
