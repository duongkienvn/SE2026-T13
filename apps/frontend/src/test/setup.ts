import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// The default 1s for findBy/waitFor is too short when the whole suite runs in
// parallel on a busy machine: page tests render the full app with its providers.
configure({ asyncUtilTimeout: 3000 });

// Vitest globals are off, so Testing Library cannot register its own cleanup.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  document.title = '';
});
