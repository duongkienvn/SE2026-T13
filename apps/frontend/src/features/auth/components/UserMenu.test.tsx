import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi, ok, storeSession, testUser } from '../../../test/mock-api';
import { renderApp } from '../../../test/render';

async function openMenu() {
  storeSession();
  mockApi({ 'GET /users/me': ok(testUser) });
  renderApp('/boards');
  const button = await screen.findByRole('button', {
    name: `Account menu for ${testUser.displayName}`,
  });
  fireEvent.click(button);
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy();
  return button;
}

describe('UserMenu', () => {
  it('shows the signed-in user and closes on Escape, returning focus', async () => {
    const button = await openMenu();
    expect(screen.getByText(testUser.email)).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
  });

  it('closes when clicking outside', async () => {
    await openMenu();

    fireEvent.pointerDown(screen.getByRole('heading', { name: 'Boards' }));

    expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull();
  });

  it('stays open when clicking inside the menu', async () => {
    await openMenu();

    fireEvent.pointerDown(screen.getByText(testUser.email));

    expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy();
  });
});
