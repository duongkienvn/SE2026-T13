import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, ok, storeSession, testUser } from '../../../test/mock-api';
import { renderApp } from '../../../test/render';

afterEach(() => {
  localStorage.removeItem('kanvexa.sidebar.expanded');
  vi.restoreAllMocks();
});

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
    const actions = screen.getByRole('group', { name: 'Account actions' });
    expect(actions.parentElement).toBe(document.body);
    expect(document.activeElement).toBe(
      within(actions).getByRole('link', { name: 'Settings' }),
    );
    expect(
      within(screen.getByRole('banner')).queryByRole('button', {
        name: /Account menu/,
      }),
    ).toBeNull();
    expect(
      within(screen.getByRole('banner')).getByRole('img', {
        name: `Signed in as ${testUser.displayName}`,
      }),
    ).toBeTruthy();

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

    fireEvent.pointerDown(
      screen.getByRole('group', { name: 'Account actions' }),
    );

    expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy();
  });

  it('closes when keyboard focus leaves the disclosure', async () => {
    const trigger = await openMenu();
    act(() => screen.getByRole('main').focus());
    expect(screen.queryByRole('group', { name: 'Account actions' })).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it.each([false, true])(
    'keeps the popover visible outside the rail (collapsed: %s)',
    async (collapsed) => {
      if (collapsed) localStorage.setItem('kanvexa.sidebar.expanded', 'false');
      const measure = HTMLElement.prototype.getBoundingClientRect;
      vi.spyOn(
        HTMLElement.prototype,
        'getBoundingClientRect',
      ).mockImplementation(function (this: HTMLElement) {
        const label = this.getAttribute('aria-label');
        if (label === `Account menu for ${testUser.displayName}`)
          return new DOMRect(20, 700, collapsed ? 44 : 220, 52);
        if (label === 'Account actions') return new DOMRect(0, 0, 256, 104);
        return measure.call(this);
      });
      vi.stubGlobal('innerWidth', 1280);
      vi.stubGlobal('innerHeight', 800);
      const trigger = await openMenu();
      const actions = screen.getByRole('group', { name: 'Account actions' });
      expect(parseFloat(actions.style.top)).toBeLessThan(700);
      expect(parseFloat(actions.style.top) + 104).toBeLessThanOrEqual(800);
      expect(parseFloat(actions.style.left) + 256).toBeLessThanOrEqual(1280);
      if (collapsed) {
        expect(trigger.textContent).toBe('AL');
        expect(trigger.querySelector('svg')).toBeNull();
        expect(parseFloat(actions.style.left)).toBeGreaterThanOrEqual(64);
      } else {
        expect(trigger.textContent).toContain(testUser.email);
        expect(parseFloat(actions.style.top) + 104).toBeLessThan(700);
      }
    },
  );

  it('reuses signOut after choosing Log out from the footer', async () => {
    storeSession();
    const calls = mockApi({
      'GET /users/me': ok(testUser),
      'POST /auth/logout': { status: 204 },
    });
    const { router } = renderApp('/boards');
    fireEvent.click(
      await screen.findByRole('button', {
        name: `Account menu for ${testUser.displayName}`,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(router.state.location.pathname).toBe('/login');
    expect(sessionStorage.getItem('kanban.session')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Account actions' })).toBeNull();
    expect(calls.filter((call) => call.path === '/auth/logout')).toHaveLength(
      1,
    );
  });
});
