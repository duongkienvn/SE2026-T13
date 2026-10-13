import { useQuery } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AppProviders } from './AppProviders';

afterEach(cleanup);

function QueryProbe() {
  const { data } = useQuery({
    queryKey: ['probe'],
    queryFn: () => Promise.resolve('query client ready'),
  });
  return <p>{data ?? 'loading'}</p>;
}

describe('AppProviders', () => {
  it('provides a working TanStack Query client', async () => {
    render(
      <AppProviders>
        <QueryProbe />
      </AppProviders>,
    );

    expect(await screen.findByText('query client ready')).toBeTruthy();
  });
});
