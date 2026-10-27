import { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { okPage } from '../test/board-fixtures';
import { mockApi, ok, storeSession, testUser } from '../test/mock-api';
import { renderApp } from '../test/render';

afterEach(() => {
  localStorage.removeItem('kanvexa.sidebar.expanded');
  vi.restoreAllMocks();
});

describe('App Shell brand navigation', () => {
  it.each([
    'sidebar logo',
    'sidebar wordmark',
    'collapsed logo',
    'header logo',
    'drawer brand',
  ])(
    'navigates from %s to authenticated Landing and back without clearing the session or cache',
    async (placement) => {
      vi.stubGlobal('matchMedia', () => ({
        matches:
          !placement.startsWith('header') && !placement.startsWith('drawer'),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }));
      storeSession();
      const session = sessionStorage.getItem('kanban.session');
      const calls = mockApi({
        'GET /users/me': ok(testUser),
        'GET /boards?page=1&limit=100': okPage([]),
      });
      const clear = vi.spyOn(QueryClient.prototype, 'clear');
      const removeQueries = vi.spyOn(QueryClient.prototype, 'removeQueries');
      const root = document.createElement('div');
      root.id = 'root';
      document.body.append(root);
      const view = renderApp('/boards');
      root.append(view.container);
      try {
        await screen.findByRole('heading', { name: 'Boards' });
        if (placement === 'collapsed logo') {
          fireEvent.click(
            screen.getByRole('button', { name: 'Collapse sidebar' }),
          );
        }
        let scope = screen.getByRole('navigation', { name: 'Primary' });
        if (placement === 'header logo') scope = screen.getByRole('banner');
        if (placement === 'drawer brand') {
          const opener = screen.getByRole('button', {
            name: 'Open navigation',
          });
          opener.focus();
          fireEvent.click(opener);
          scope = screen.getByRole('dialog', { name: 'Navigation menu' });
          expect(root.hasAttribute('inert')).toBe(true);
          expect(document.body.style.overflow).toBe('hidden');
        }
        const brand = within(scope).getByRole('link', {
          name: 'Kanvexa landing page',
        });
        expect(brand.getAttribute('href')).toBe('/');
        expect(brand.tabIndex).toBe(0);
        if (placement === 'collapsed logo') {
          expect(brand.textContent).toBe('');
          expect(brand.title).toBe('Kanvexa landing page');
        }
        fireEvent.click(
          placement === 'sidebar wordmark'
            ? within(brand).getByText('Kanvexa')
            : placement.includes('logo')
              ? brand.querySelector('img')!
              : brand,
        );
        expect(view.router.state.location.pathname).toBe('/');
        const boards = await screen.findByRole('link', {
          name: 'Go to Boards',
        });
        expect(sessionStorage.getItem('kanban.session')).toBe(session);
        expect(clear).not.toHaveBeenCalled();
        expect(removeQueries).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.querySelector('[data-drawer-backdrop]')).toBeNull();
        expect(root.hasAttribute('inert')).toBe(false);
        expect(document.body.style.overflow).toBe('');
        expect(document.activeElement?.closest('[role="dialog"]')).toBeNull();
        await act(() => view.router.navigate(-1));
        await screen.findByRole('heading', { name: 'Boards' });
        await act(() => view.router.navigate(1));
        fireEvent.click(
          await screen.findByRole('link', { name: 'Go to Boards' }),
        );
        await screen.findByRole('heading', { name: 'Boards' });
        expect(boards.getAttribute('href')).toBe('/boards');
        expect(calls.filter((call) => call.path === '/users/me')).toHaveLength(
          1,
        );
      } finally {
        view.unmount();
        root.remove();
      }
    },
  );
});
