import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../../test/render';
import { mockApi } from '../../../test/mock-api';

describe('scoped auth entry presentation', () => {
  it.each(['/login', '/register'])(
    'opts %s into the entry composition without leaking presentation props to inputs',
    (path) => {
      const { container } = renderApp(path);
      expect(container.querySelector('[data-auth-entry]')).toBeTruthy();
      for (const input of container.querySelectorAll('input')) {
        expect(input.hasAttribute('appearance')).toBe(false);
        expect(input.autocomplete).not.toBe('off');
      }
      const art = container.querySelector('.auth-entry-illustration');
      expect(art?.getAttribute('aria-hidden')).toBe('true');
      expect(art?.querySelectorAll('a, button, input, [tabindex]').length).toBe(
        0,
      );
      expect(screen.getAllByRole('main')).toHaveLength(1);
    },
  );

  it.each([
    ['/login', 0],
    ['/login', 1],
    ['/register', 0],
    ['/register', 1],
  ] as const)(
    'navigates from %s brand placement %s to the public home',
    async (path, placement) => {
      const calls = mockApi({});
      const { router } = renderApp(path);
      const home = screen.getAllByRole('link', { name: 'Kanvexa home' })[
        placement
      ];
      expect(home.getAttribute('href')).toBe('/');
      home.focus();
      expect(document.activeElement).toBe(home);
      expect(home.querySelector('img')?.getAttribute('src')).toBe(
        '/branding/kanvexa-logo-v1.png',
      );
      fireEvent.click(home);
      await waitFor(() => expect(router.state.location.pathname).toBe('/'));
      expect(calls).toHaveLength(0);
    },
  );

  it.each([
    '/forgot-password',
    '/reset-password',
    '/check-email',
    '/verify-email',
  ])('keeps %s on its original layout and control presentation', (path) => {
    const { container } = renderApp(path);
    expect(container.querySelector('[data-auth-entry]')).toBeNull();
    expect(container.querySelector('.auth-entry-input')).toBeNull();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Kanvexa home' })).toBeNull();
  });

  it('keeps registration guidance immediately after the new password through validation', () => {
    mockApi({});
    renderApp('/register');
    const password = screen.getByLabelText('Password');
    const confirmation = screen.getByLabelText('Confirm password');
    const requirements = screen.getByRole('list', {
      name: 'Password requirements',
    });
    expect(
      password.compareDocumentPosition(requirements) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      requirements.compareDocumentPosition(confirmation) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const descriptionId = password.getAttribute('aria-describedby')!;
    const guidance = document.getElementById(descriptionId)!;
    expect(within(guidance).getByText('Maximum 128 characters')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Display name'));
    expect(password.getAttribute('aria-describedby')?.split(' ')).toContain(
      descriptionId,
    );
    expect(password.getAttribute('aria-invalid')).toBe('true');
  });
});
