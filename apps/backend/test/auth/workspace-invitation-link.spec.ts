import {
  invitationAcceptPath,
  workspaceInvitationLink,
} from '../../src/mail/workspace-invitation-link';

const proof = 'A_-'.repeat(14) + 'B';
// Synthetic contract route; this does not define a production frontend route.
const path = '/qa/workspace-invitation';

describe('Workspace invitation destination', () => {
  it('keeps proof only in the fragment of the configured origin/path', () => {
    const link = new URL(
      workspaceInvitationLink('https://example.test', path, proof),
    );
    expect(link.origin).toBe('https://example.test');
    expect(link.pathname).toBe(path);
    expect(link.search).toBe('');
    expect(new URLSearchParams(link.hash.slice(1)).get('proof')).toBe(proof);
    expect(
      workspaceInvitationLink('http://localhost:5173', path, proof),
    ).toContain(path);
  });

  it('gates delivery when no acceptance route is configured', () => {
    expect(invitationAcceptPath(undefined)).toBe('');
    expect(invitationAcceptPath('')).toBe('');
    expect(() =>
      workspaceInvitationLink('https://example.test', '', proof),
    ).toThrow('unavailable');
  });

  it.each([
    '//evil.test/path',
    'https://evil.test',
    '/',
    '/a/../b',
    '/a%2fb',
    '/a?next=evil',
    '/a#proof=x',
    '/a\\b',
    '/a\n',
    null,
    true,
  ])('rejects unsafe destination %s', (value) => {
    expect(() => invitationAcceptPath(value)).toThrow(
      'WORKSPACE_INVITATION_ACCEPT_PATH',
    );
  });

  it.each([
    'http://remote.test',
    'https://user:pass@example.test',
    'https://example.test/path',
    'https://example.test?next=x',
    'https://example.test#x',
    'javascript:alert(1)',
  ])('rejects unsafe origin %s', (origin) => {
    expect(() => workspaceInvitationLink(origin, path, proof)).toThrow();
  });

  it.each(['', 'a'.repeat(42), 'a'.repeat(44), 'x/?.'.repeat(11)])(
    'rejects malformed proof',
    (token) => {
      expect(() =>
        workspaceInvitationLink('https://example.test', path, token),
      ).toThrow('Invalid invitation proof');
    },
  );
});
