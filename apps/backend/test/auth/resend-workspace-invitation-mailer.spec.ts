import { WorkspaceRole } from '@kanban/shared';
import { Resend } from 'resend';
import { ResendWorkspaceInvitationMailer } from '../../src/mail/resend-workspace-invitation-mailer';

const payload = {
  invitationId: 'invitation',
  workspaceId: 'workspace',
  workspaceName: 'Team',
  recipient: 'recipient@example.test',
  role: WorkspaceRole.MEMBER,
  proof: 'a'.repeat(43),
  expiresAt: new Date('2026-11-04T09:30:00Z'),
  idempotencyKey: 'workspace-invitation/invitation',
};
const adapter = (client: Resend, timeout = 10000) =>
  new ResendWorkspaceInvitationMailer(
    client,
    'Kanvexa <no-reply@example.test>',
    'https://example.test',
    '/qa/invite',
    timeout,
  );
const mockAdapter = (send: jest.Mock) =>
  adapter({ emails: { send } } as unknown as Resend);

describe('Resend Workspace invitation delivery (no real network)', () => {
  it('uses recipient, branded content, stable provider key and existing abort timeout', async () => {
    const send = jest
      .fn()
      .mockResolvedValue({ data: { id: 'accepted' }, error: null });
    expect(await mockAdapter(send).send(payload)).toBe('SENT');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Kanvexa <no-reply@example.test>',
        to: [payload.recipient],
        html: expect.stringContaining('Join Workspace'),
        text: expect.stringContaining(`#proof=${payload.proof}`),
      }),
      {
        idempotencyKey: payload.idempotencyKey,
        signal: expect.any(AbortSignal),
      },
    );
  });

  it.each([400, 401, 403, 422, 429])(
    'returns FAILED for explicit HTTP %s rejection',
    async (statusCode) => {
      const send = jest
        .fn()
        .mockResolvedValue({
          data: null,
          error: { statusCode, message: payload.proof },
        });
      expect(await mockAdapter(send).send(payload)).toBe('FAILED');
      expect(send).toHaveBeenCalledTimes(1);
    },
  );

  it.each([408, 409, 500, 503, null, undefined])(
    'returns UNKNOWN for uncertain HTTP %s outcome',
    async (statusCode) => {
      const send = jest
        .fn()
        .mockResolvedValue({
          data: null,
          error: { statusCode, message: payload.proof },
        });
      expect(await mockAdapter(send).send(payload)).toBe('UNKNOWN');
      expect(send).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { data: null, error: null },
    { data: {}, error: null },
  ])('does not report a malformed acceptance as SENT', async (result) => {
    expect(
      await mockAdapter(jest.fn().mockResolvedValue(result)).send(payload),
    ).toBe('UNKNOWN');
  });

  it('returns UNKNOWN on network errors without retrying or propagating the proof', async () => {
    const send = jest.fn().mockRejectedValue(new Error(payload.proof));
    expect(await mockAdapter(send).send(payload)).toBe('UNKNOWN');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('returns FAILED before network I/O for invalid content', async () => {
    const send = jest.fn();
    expect(await mockAdapter(send).send({ ...payload, proof: 'invalid' })).toBe(
      'FAILED',
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('silences real SDK error-body logging even when provider echoes a proof in development', async () => {
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            name: 'validation_error',
            statusCode: 422,
            message: payload.proof,
          }),
          { status: 422 },
        ),
      );
    const log = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const prior = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      expect(
        await adapter(new Resend('re_synthetic_unit_only')).send(payload),
      ).toBe('FAILED');
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(log).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = prior;
      fetch.mockRestore();
      log.mockRestore();
    }
  });

  it('bounds a stalled real SDK request and maps abort to UNKNOWN', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url, options) =>
        new Promise((_resolve, reject) => {
          const signal = options?.signal;
          if (signal?.aborted) reject(signal.reason);
          else
            signal?.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
        }),
    );
    const log = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      expect(
        await adapter(new Resend('re_synthetic_unit_only'), 5).send(payload),
      ).toBe('UNKNOWN');
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(log).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
      log.mockRestore();
    }
  });
});
