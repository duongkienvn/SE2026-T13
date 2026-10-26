import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { openPermalink } from '../../../test/permalink-fixtures';

const detail = () => screen.findByRole('dialog', { name: 'Private card' });

describe('card permalink detail', () => {
  it('loads directly and closes safely without a fabricated history entry', async () => {
    const { router, path, cardPath } = openPermalink({ direct: true });
    const dialog = await detail();
    expect(router.state.location.pathname).toBe(cardPath);
    expect(within(dialog).getByLabelText('Title')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close card' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(path));
    expect(router.state.historyAction).toBe('REPLACE');
    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe(path);
  });

  it('warns on closing or browser Back with a dirty form and retains edits when canceled', async () => {
    const { router, path, cardPath } = openPermalink();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Private card' }),
    );
    const dialog = await detail();
    fireEvent.change(within(dialog).getByLabelText('Description'), {
      target: { value: 'Unsaved draft' },
    });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(await screen.findByText(/unsaved card changes/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(router.state.location.pathname).toBe(cardPath);
    expect(
      within(dialog).getByLabelText<HTMLTextAreaElement>('Description').value,
    ).toBe('Unsaved draft');
    await act(() => router.navigate(-1));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Discard changes' }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe(path));
  });

  it('copies the absolute same-origin link only after clipboard success', async () => {
    let copied: (() => void) | undefined;
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          copied = resolve;
        }),
    );
    vi.stubGlobal('isSecureContext', true);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const { cardPath } = openPermalink({ direct: true });
    fireEvent.click(
      within(await detail()).getByRole('button', { name: 'Copy link' }),
    );
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}${cardPath}`,
    );
    expect(screen.queryByText('Link copied.')).toBeNull();
    await act(async () => copied?.());
    expect(await screen.findByText('Link copied.')).toBeTruthy();
  });

  it('offers a selectable link when clipboard access fails', async () => {
    vi.stubGlobal('isSecureContext', true);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi
          .fn()
          .mockRejectedValue(new DOMException('Denied', 'NotAllowedError')),
      },
    });
    const { cardPath } = openPermalink({ direct: true });
    fireEvent.click(
      within(await detail()).getByRole('button', { name: 'Copy link' }),
    );
    const input = await screen.findByLabelText<HTMLInputElement>('Card link');
    expect(input.value).toBe(`${window.location.origin}${cardPath}`);
    expect(input.readOnly).toBe(true);
    fireEvent.focus(input);
    expect(input.selectionEnd).toBe(input.value.length);
    expect(screen.queryByText('Link copied.')).toBeNull();
  });
});
