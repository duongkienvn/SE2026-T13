import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mockApi, ok, storeSession, testUser } from '../test/mock-api';
import { renderApp } from '../test/render';

vi.mock('./BoardsPage', () => ({
  BoardsPage: () => {
    throw new Error('secret internal failure at BoardsPage.tsx:12');
  },
}));

describe('RouteErrorPage', () => {
  it('replaces a crashed page with a safe message and recovery actions', async () => {
    // React and React Router log the thrown error; keep test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    storeSession();
    mockApi({ 'GET /users/me': ok(testUser) });
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });

    renderApp('/boards');

    expect(
      await screen.findByRole('heading', { name: 'Something went wrong' }),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain('secret internal failure');
    expect(document.body.textContent).not.toContain('BoardsPage.tsx');
    expect(screen.getByRole('link', { name: 'Go to home' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reload page' }));
    expect(reload).toHaveBeenCalledOnce();
  });
});
