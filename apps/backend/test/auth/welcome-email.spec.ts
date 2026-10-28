import { welcomeEmail } from '../../src/mail/welcome-email';

describe('welcome email', () => {
  it('renders consistent onboarding, a supported CTA and transactional footer', () => {
    const { subject, html, text } = welcomeEmail('https://kanvexa.tech');
    expect(subject).toBe("Welcome to Kanvexa — Let's Get Started!");
    for (const copy of [
      'Welcome to Kanvexa!',
      "We're excited to have you here.",
      'Your Personal Workspace is ready.',
      'Explore your Workspace',
      'Create your first Board',
      'Add tasks and keep work moving',
      'The Kanvexa Team',
      "You're receiving this account email because you signed up for Kanvexa.",
    ]) {
      expect(html).toContain(copy);
      expect(text).toContain(copy);
    }
    expect(
      html.match(/href="https:\/\/kanvexa.tech\/workspaces"/g),
    ).toHaveLength(2);
    expect(text).toContain(
      'Explore Your Workspace: https://kanvexa.tech/workspaces',
    );
    expect(html).toContain('href="https://kanvexa.tech/"');
    expect(text).toContain('Visit Kanvexa: https://kanvexa.tech/');
    expect(html).not.toMatch(
      /pricing|subscription|unsubscribe|tracking|<script|<iframe|@import/i,
    );
  });

  it('uses fluid presentation tables, inline fallbacks, dark colors and a text wordmark', () => {
    const { html } = welcomeEmail('http://localhost:5173');
    for (const [tag] of html.matchAll(/<table\b[^>]*>/g)) {
      expect(tag).toContain('role="presentation"');
      expect(tag).toContain('cellpadding="0"');
      expect(tag).toContain('cellspacing="0"');
    }
    expect(html).toContain('max-width:600px;table-layout:fixed');
    expect(html).toContain('<!--[if mso]>');
    expect(html).toContain('mso-padding-alt:16px 20px');
    expect(html).toContain('@media (prefers-color-scheme: dark)');
    expect(html).toContain('bgcolor="#615CF7"');
    expect(html).toContain('>Kanvexa</td>');
    expect(html.match(/<img\b/g)).toHaveLength(1);
    expect(html).toContain('width="48" height="48" alt=""');
    expect(html).not.toMatch(/display\s*:\s*(flex|grid)|src="(?:cid:|data:)/);
  });

  it.each([
    'javascript:alert(1)',
    'https://user:pass@example.test',
    'https://example.test/path',
    'https://example.test?x="<script>',
    'https://example.test#fragment',
    'http://example.test',
  ])('rejects an unsafe origin %s', (origin) => {
    expect(() => welcomeEmail(origin)).toThrow();
  });

  it('normalizes URLs before HTML interpolation and accepts loopback preview origins', () => {
    const { html, text } = welcomeEmail("https://safe'origin.example");
    expect(html).toContain('https://safe&#39;origin.example/workspaces');
    expect(html).not.toContain('href="https://safe\'origin');
    expect(text).toContain("https://safe'origin.example/workspaces");
    expect(welcomeEmail('http://127.0.0.1:5173').text).toContain('/workspaces');
  });
});
