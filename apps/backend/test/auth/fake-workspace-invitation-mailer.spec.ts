import { WorkspaceRole } from '@kanban/shared';
import { FakeWorkspaceInvitationMailer } from '../../src/mail/fake-workspace-invitation-mailer';

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
const fake = () =>
  new FakeWorkspaceInvitationMailer(
    'Kanvexa <no-reply@example.test>',
    'https://example.test',
    '/qa/invite',
  );

describe('fake Workspace invitation delivery', () => {
  it('captures the correct recipient and link only in bounded memory, with deduplication', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch');
    try {
      const mailer = fake();
      expect(await mailer.send(payload)).toBe('SENT');
      expect(await mailer.send(payload)).toBe('SENT');
      expect(mailer.deliveries).toHaveLength(1);
      expect(mailer.deliveries[0].message.to).toBe(payload.recipient);
      expect(mailer.deliveries[0].message.text).toContain(
        `#proof=${payload.proof}`,
      );
      for (let i = 0; i < 25; i++)
        await mailer.send({
          ...payload,
          idempotencyKey: `workspace-invitation/${i}`,
        });
      expect(mailer.deliveries).toHaveLength(20);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });

  it('does not claim success for an unrenderable message', async () => {
    const mailer = fake();
    expect(await mailer.send({ ...payload, proof: 'malformed' })).toBe(
      'FAILED',
    );
    expect(mailer.deliveries).toEqual([]);
  });
});
