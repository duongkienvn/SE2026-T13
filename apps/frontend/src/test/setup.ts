import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { createdSockets } from './fake-socket';

// No test opens a real connection; read the sockets from `createdSockets`.
vi.mock('../features/realtime/socket-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createRealtimeSocket: (await import('./fake-socket')).fakeRealtimeSocket,
}));

// The default 1s for findBy/waitFor is too short when the whole suite runs in
// parallel on a busy machine: page tests render the full app with its providers.
configure({ asyncUtilTimeout: 3000 });

// Vitest globals are off, so Testing Library cannot register its own cleanup.
afterEach(() => {
  cleanup();
  createdSockets.length = 0;
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.removeItem('kanban.session');
  document.title = '';
});
