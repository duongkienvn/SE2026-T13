import { render } from '@testing-library/react';
import {
  createMemoryRouter,
  RouterProvider,
  type InitialEntry,
} from 'react-router';
import { AppProviders } from '../app/AppProviders';
import { routes } from '../app/routes';

/** Renders the full app (providers + routes) at `path` using an in-memory router. */
export function renderApp(path: InitialEntry) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const result = render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...result, router };
}
