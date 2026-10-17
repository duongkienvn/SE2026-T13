import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BoardRealtimeStatus } from '../board-realtime-client';
import { RealtimeStatus } from './RealtimeStatus';

describe('RealtimeStatus', () => {
  it.each<BoardRealtimeStatus>(['connecting', 'live', 'unavailable'])(
    'shows nothing while %s',
    (status) => {
      const { container } = render(
        <RealtimeStatus status={status} retry={vi.fn()} />,
      );
      expect(container.innerHTML).toBe('');
    },
  );

  it('says it is reconnecting, without a button', () => {
    render(<RealtimeStatus status="reconnecting" retry={vi.fn()} />);

    expect(screen.getByRole('status').textContent).toBe('Reconnecting…');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers Retry once paused', () => {
    const retry = vi.fn();
    render(<RealtimeStatus status="paused" retry={retry} />);

    expect(screen.getByRole('status').textContent).toContain(
      'Live updates paused',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
