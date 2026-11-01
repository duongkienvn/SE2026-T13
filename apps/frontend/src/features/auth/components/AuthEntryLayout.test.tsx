import { fireEvent, screen, within } from '@testing-library/react';
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
      const art = container.querySelector('svg.auth-entry-illustration');
      expect(art?.getAttribute('aria-hidden')).toBe('true');
      expect(art?.getAttribute('focusable')).toBe('false');
      expect(screen.getAllByRole('main')).toHaveLength(1);
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
