import type { Resend } from 'resend';
import {
  emailChangedSecurityEmail,
  emailChangeProofEmail,
} from '../../src/mail/email-change-email';
import {
  FakeEmailChangeMailer,
  ResendEmailChangeMailer,
} from '../../src/mail/email-change-mailer';

describe('mandatory email change mail', () => {
  it('escapes proof URLs in branded HTML and supplies an equivalent plain-text link', () => {
    const url =
      'https://kanvexa.test/confirm-email-change?token=proof&extra="<bad>';
    const message = emailChangeProofEmail(url);
    expect(message.html).toContain('Kanvexa');
    expect(message.html).toContain('30 minutes');
    expect(message.html).not.toContain('"<bad>');
    expect(message.html).toContain('&amp;');
    expect(message.text).toContain(url);
    expect(message.html).toContain('no-referrer');
    expect(message.html).not.toContain('<img');
  });
  it('old-mailbox alert contains no proof, target email or third-party tracking', () => {
    const message = emailChangedSecurityEmail('https://kanvexa.test/base');
    expect(message.text).toContain('Previous sessions have been invalidated');
    expect(message.text).toContain('https://kanvexa.test/login');
    expect(message.html).not.toMatch(/token=|newEmail|<img/);
  });
  it('captures both independent security messages only in fake memory', async () => {
    const fake = new FakeEmailChangeMailer('https://kanvexa.test');
    await fake.sendProof(
      'new@example.test',
      'https://kanvexa.test/confirm-email-change?token=test',
    );
    await fake.sendSecurityAlert('old@example.test');
    expect(fake.proofs[0].email).toBe('new@example.test');
    expect(fake.alerts[0].email).toBe('old@example.test');
    expect(fake.alerts[0].message.text).not.toContain('new@example.test');
  });
  it('bounds Resend calls, uses idempotency and sanitizes errors without retry', async () => {
    const send = jest
      .fn()
      .mockResolvedValue({ data: { id: 'accepted' }, error: null });
    const mailer = new ResendEmailChangeMailer(
      { emails: { send } } as unknown as Resend,
      'Kanvexa <security@kanvexa.test>',
      'https://kanvexa.test',
      50,
    );
    await mailer.sendProof(
      'new@example.test',
      'https://kanvexa.test/confirm-email-change?token=secret',
      'proof-key',
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['new@example.test'] }),
      { idempotencyKey: 'proof-key', signal: expect.any(AbortSignal) },
    );
    send.mockRejectedValue(
      new Error('credential-sentinel private-target@example.test'),
    );
    await expect(
      mailer.sendSecurityAlert('old@example.test', 'alert-key'),
    ).rejects.toThrow('Email change mail provider unavailable');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][1].idempotencyKey).toBe('alert-key');
  });
  it.each([
    { data: null, error: { message: 'private' } },
    { data: null, error: null },
  ])('fails safely on provider rejection %#', async (result) => {
    const send = jest.fn().mockResolvedValue(result);
    const mailer = new ResendEmailChangeMailer(
      { emails: { send } } as unknown as Resend,
      'from',
      'https://kanvexa.test',
    );
    await expect(
      mailer.sendProof('to', 'https://kanvexa.test', 'key'),
    ).rejects.toThrow('Email change mail provider unavailable');
    expect(send).toHaveBeenCalledTimes(1);
  });
});
