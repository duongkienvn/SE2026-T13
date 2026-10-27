import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';

let desktop = false;
const listeners = new Set<() => void>();

beforeEach(() => {
  desktop = false;
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return desktop;
    },
    addEventListener: (_event: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) =>
      listeners.delete(listener),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  listeners.clear();
});

function renderShell(path = '/boards') {
  const shell = (
    <AppShell
      activeNavItemId="boards"
      drawerFooter={<button type="button">Log out</button>}
    >
      <p>Page body</p>
    </AppShell>
  );
  const router = createMemoryRouter(
    [
      { path: '/boards', element: shell },
      { path: '/profile', element: shell },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const menuButton = () =>
  screen.getByRole('button', { name: 'Open navigation' });
const openDrawer = () => {
  fireEvent.click(menuButton());
  return screen.getByRole('dialog', { name: 'Navigation menu' });
};

describe('Navigation drawer', () => {
  it('opens a labelled modal with the full navigation hierarchy', () => {
    renderShell();
    expect(menuButton().getAttribute('aria-expanded')).toBe('false');
    const drawer = openDrawer();

    expect(drawer.getAttribute('aria-modal')).toBe('true');
    expect(menuButton().getAttribute('aria-expanded')).toBe('true');
    expect(menuButton().getAttribute('aria-controls')).toBe(drawer.id);
    const nav = within(within(drawer).getByRole('navigation'));
    expect(nav.getByRole('group', { name: 'Personal' })).toBeTruthy();
    expect(nav.getByRole('group', { name: 'Workspaces' })).toBeTruthy();
    expect(
      nav.getByRole('link', { name: 'Boards' }).getAttribute('aria-current'),
    ).toBe('page');
    for (const label of ['Home', 'My Tasks', 'Starred', 'Create Workspace']) {
      const item = drawer.querySelector(`li[title="${label} — coming soon"]`);
      expect(item?.querySelector('a, button')).toBeNull();
    }
    expect(nav.queryByRole('link', { name: /Home|Starred/ })).toBeNull();
    expect(
      drawer.querySelector('[title="Workspace switcher — coming soon"]'),
    ).toBeTruthy();
    expect(
      within(drawer).getByRole('button', { name: 'Log out' }),
    ).toBeTruthy();
    expect(drawer.textContent).not.toMatch(/free plan|upgrade|pricing/i);
  });

  it('moves focus in, traps Tab and locks page scroll', () => {
    renderShell();
    const drawer = openDrawer();
    const close = within(drawer).getByRole('button', {
      name: 'Close navigation',
    });
    expect(document.activeElement).toBe(close);
    expect(document.body.style.overflow).toBe('hidden');

    const logout = within(drawer).getByRole('button', { name: 'Log out' });
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(logout);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
  });

  it.each([
    ['Escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
    [
      'the close button',
      () =>
        fireEvent.click(
          screen.getByRole('button', { name: 'Close navigation' }),
        ),
    ],
    [
      'a backdrop click',
      () =>
        fireEvent.click(
          document.querySelector<HTMLElement>('[data-drawer-backdrop]')!,
        ),
    ],
  ])('closes on %s and restores focus to the menu button', (_name, close) => {
    renderShell();
    menuButton().focus();
    openDrawer();
    act(close);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(menuButton());
    expect(menuButton().getAttribute('aria-expanded')).toBe('false');
    expect(document.body.style.overflow).toBe('');
  });

  it('closes after navigating, including back to the same page', async () => {
    const router = renderShell('/profile');
    const drawer = openDrawer();
    fireEvent.click(within(drawer).getByRole('link', { name: 'Boards' }));
    expect(router.state.location.pathname).toBe('/boards');
    expect(screen.queryByRole('dialog')).toBeNull();

    openDrawer();
    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe('/profile');
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(() => router.navigate(1));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes when the viewport reaches the desktop sidebar', () => {
    renderShell();
    openDrawer();
    act(() => {
      desktop = true;
      listeners.forEach((listener) => listener());
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => {
      desktop = false;
      listeners.forEach((listener) => listener());
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });
});
