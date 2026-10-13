import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';
import { AppProviders } from './app/AppProviders';

describe('App', () => {
  it('renders the application shell inside the providers', () => {
    render(
      <AppProviders>
        <App />
      </AppProviders>,
    );

    expect(
      screen.getByRole('heading', { name: 'Realtime Collaborative Kanban' }),
    ).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeTruthy();
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
  });

  it('marks navigation items without a feature as unavailable', () => {
    render(
      <AppProviders>
        <App />
      </AppProviders>,
    );

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const items = within(nav).getAllByRole('button');

    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.getAttribute('aria-disabled')).toBe('true');
      expect(item.getAttribute('aria-current')).toBeNull();
    }
  });
});
