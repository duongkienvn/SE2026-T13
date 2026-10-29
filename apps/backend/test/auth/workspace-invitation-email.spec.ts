import { WorkspaceRole } from '@kanban/shared';
import { workspaceInvitationEmail } from '../../src/mail/workspace-invitation-email';
import { escapeHtml } from '../../src/mail/verification-email';

const payload = {
  invitationId: 'synthetic-invitation',
  workspaceId: 'synthetic-workspace',
  workspaceName: `Dự án 東京 & <img src=x onerror="alert('x')"> ${'LongName'.repeat(25)}`,
  recipient: 'target&test@example.test',
  role: WorkspaceRole.MEMBER,
  proof: 'a'.repeat(43),
  expiresAt: new Date('2026-11-04T09:30:00Z'),
  idempotencyKey: 'workspace-invitation/synthetic-invitation',
};

describe('Workspace invitation email', () => {
  it('renders deterministic escaped Unicode, recipient, role and exact UTC expiry', () => {
    const content = workspaceInvitationEmail(
      payload,
      'https://example.test',
      '/qa/invite',
    );
    expect(content).toEqual(
      workspaceInvitationEmail(payload, 'https://example.test', '/qa/invite'),
    );
    expect(content.html).toContain(escapeHtml(payload.workspaceName));
    expect(content.html).toContain(escapeHtml(payload.recipient));
    expect(content.html).not.toContain('<img src=x');
    expect(content.text).toContain(payload.workspaceName);
    for (const body of [content.html, content.text]) {
      expect(body).toContain('2026-11-04 09:30:00 UTC');
      expect(body).toContain('Member');
      expect(body).toContain('only after accepting a valid invitation');
      expect(body).not.toContain(payload.invitationId);
      expect(body).not.toContain(payload.workspaceId);
      expect(body).not.toContain(payload.idempotencyKey);
    }
    expect(content.subject).not.toContain(payload.workspaceName);
  });

  it('uses identical fragment links in the CTA, fallback and text, and one token-free branding image', () => {
    const { html, text } = workspaceInvitationEmail(
      payload,
      'https://example.test',
      '/qa/invite',
    );
    const links = [...html.matchAll(/href="([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(links).toEqual(
      Array(2).fill(`https://example.test/qa/invite#proof=${payload.proof}`),
    );
    expect(text).toContain(links[0]);
    expect(html).toContain('Join Workspace</a>');
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html).toContain(
      'src="https://kanvexa.tech/branding/kanvexa-logo-v1.png"',
    );
    expect(html).not.toMatch(
      /<script|<iframe|<form|<link|tracking|unsubscribe/i,
    );
    expect(html).toContain('prefers-color-scheme: dark');
    expect(html).toContain('#615CF7');
    expect(html).toContain('overflow-wrap:anywhere');
  });
});
