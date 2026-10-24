import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi } from '../test/mock-api';
import { renderApp } from '../test/render';

describe('Kanvexa authentication branding', () => {
  it.each([
    ['/login', 'Welcome back', 'Log in'],
    ['/register', 'Create your account', 'Create account'],
    ['/check-email', 'Check your email', 'Check your email'],
    ['/verify-email', 'Verify your email', 'Verify email'],
  ])(
    'brands %s without changing authentication requests',
    async (path, heading, title) => {
      const calls = mockApi({});
      renderApp(path);

      expect(
        await screen.findByRole('heading', { name: heading }),
      ).toBeTruthy();
      expect(document.title).toBe(`${title} · Kanvexa`);
      // Both responsive placements share the same artwork. The visible wordmark
      // supplies its accessible name, so the adjacent image is decorative.
      const mobileBrand = within(screen.getByRole('main')).getByText('Kanvexa');
      const desktopBrand = screen.getByText(
        'Organize work. Move ideas forward.',
      ).parentElement!;
      for (const placement of [mobileBrand.parentElement!, desktopBrand]) {
        const logo = placement.querySelector('img');
        expect(logo?.getAttribute('src')).toBe('/branding/kanvexa-logo-v1.png');
        expect(logo?.getAttribute('alt')).toBe('');
      }
      expect(calls).toHaveLength(0);
    },
  );
});
