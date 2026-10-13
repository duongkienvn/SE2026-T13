import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState, ErrorState, LoadingState } from './states';

describe('state primitives', () => {
  it('announces loading', () => {
    render(<LoadingState label="Loading boards…" />);
    expect(screen.getByRole('status').textContent).toContain('Loading boards…');
  });

  it('renders an empty state with its action', () => {
    render(
      <EmptyState
        title="No boards"
        description="Create one to get started."
        action={<button type="button">Create</button>}
      />,
    );
    expect(screen.getByRole('heading', { name: 'No boards' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy();
  });

  it('shows an error and retries on request', () => {
    const onRetry = vi.fn();
    render(<ErrorState description="Network error" onRetry={onRetry} />);

    expect(screen.getByRole('alert').textContent).toContain('Network error');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('hides the retry button without a handler', () => {
    render(<ErrorState />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
