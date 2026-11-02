import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { describe, expect, it } from 'vitest';
import { useBoardFilters } from './board-filter';

function Harness() {
  const { filters, apply } = useBoardFilters();
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="url">{location.search}</output>
      <output aria-label="keyword">{filters.q ?? 'none'}</output>
      <button onClick={() => apply({ q: 'second' })}>Apply</button>
      <button onClick={() => apply({})}>Clear</button>
      <button onClick={() => void navigate(-1)}>Back</button>
      <button onClick={() => void navigate(1)}>Forward</button>
    </>
  );
}
describe('Board filter URL history', () => {
  it('retains unrelated parameters and restores applied filters with Back and Forward', () => {
    render(
      <MemoryRouter initialEntries={['/boards/board?q=first&context=keep']}>
        <Harness />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText('keyword').textContent).toBe('first');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByLabelText('keyword').textContent).toBe('second');
    expect(screen.getByLabelText('url').textContent).toContain('context=keep');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByLabelText('keyword').textContent).toBe('none');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('keyword').textContent).toBe('second');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('keyword').textContent).toBe('first');
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    expect(screen.getByLabelText('keyword').textContent).toBe('second');
  });
});
