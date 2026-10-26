import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { openPermalink } from '../../../test/permalink-fixtures';

describe('card route navigation', () => {
  it('pushes the canonical route, preserves board context on Back, and reopens on Forward', async () => {
    const { router, path, cardPath } = openPermalink();
    const opener = await screen.findByRole('button', { name: 'Private card' });
    opener.focus();
    fireEvent.click(opener);
    await screen.findByRole('dialog', { name: 'Private card' });
    expect(router.state.location.pathname).toBe(cardPath);
    await act(() => router.navigate(-1));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(router.state.location.pathname).toBe(path);
    expect(router.state.location.search).toBe('?filter=mine');
    expect(router.state.location.hash).toBe('#kanban');
    expect(screen.getByRole('button', { name: 'Private card' })).toBe(opener);
    expect(document.activeElement).toBe(opener);
    await act(() => router.navigate(1));
    await screen.findByRole('dialog', { name: 'Private card' });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(router.state.location.pathname).toBe(path));
    expect(router.state.location.search).toBe('?filter=mine');
  });
});
