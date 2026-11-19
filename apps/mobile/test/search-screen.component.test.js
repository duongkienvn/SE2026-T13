/* global jest, test, expect, afterEach */
import { URL } from 'node:url';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { SearchScreen } from '../src/features/search/SearchScreen';
import { createHttpClient } from '../src/infrastructure/api/client';
import { SessionProvider } from '../src/infrastructure/auth/SessionProvider';
import { createSessionManager } from '../src/infrastructure/auth/session-manager';
import { createCredentialStore } from '../src/infrastructure/auth/credential-store';
import { DataProvider } from '../src/infrastructure/query/DataProvider';
import { createMobileDataLayer } from '../src/infrastructure/query/data-layer';
import { ThemeContext } from '../src/ui';
import {
  FakeSessionApi,
  FakeTime,
  MemorySecureStore,
  USER_A,
  USER_B,
  loginResponse,
  user,
} from './auth/support';
import { results, cardHit } from './search/fixtures';

const mockNavigate = jest.fn();
let mockFocused = true;
jest.mock('expo-router', () => ({
  useRouter: () => ({ navigate: mockNavigate }),
  useIsFocused: () => mockFocused,
}));
jest.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isConnected: true }),
  addNetworkStateListener: () => ({ remove() {} }),
}));
function wire(data, status = 200, retryAfter = null) {
  return {
    ok: status === 200,
    status,
    headers: {
      get: (name) =>
        name === 'content-type'
          ? 'application/json'
          : name === 'retry-after'
            ? retryAfter
            : null,
    },
    text: async () =>
      JSON.stringify({
        success: status === 200,
        statusCode: status,
        message: 'OK',
        data,
      }),
  };
}
async function setup(override, mode = 'dark') {
  mockNavigate.mockClear();
  mockFocused = true;
  const clock = new FakeTime();
  const auth = new FakeSessionApi();
  auth.auto = (token) => ({
    kind: 'verified',
    user: user(token === loginResponse(USER_A).accessToken ? USER_A : USER_B),
  });
  const manager = createSessionManager({
    store: createCredentialStore(new MemorySecureStore()),
    api: auth,
    clock,
    timers: clock,
  });
  await manager.establishSession(loginResponse(USER_A));
  const requests = [];
  const data = createMobileDataLayer(
    manager,
    createHttpClient({
      baseUrl: new URL('https://search.example.test/api'),
      fetch: async (input, init) => {
        const url = new URL(input);
        requests.push({ url, init });
        const response = override?.(url, init);
        if (response) return response;
        if (url.pathname === '/api/search')
          return wire(
            results(url.searchParams.get('type'), url.searchParams.get('q')),
          );
        if (url.pathname === '/api/boards/' + cardHit.boardId)
          return wire({
            id: cardHit.boardId,
            workspaceId: cardHit.workspaceId,
            isArchived: false,
            capabilities: { canReadBoard: true, canWriteBoard: false },
          });
        return wire({}, 404);
      },
    }),
  );
  data.queryClient.setDefaultOptions({
    ...data.queryClient.getDefaultOptions(),
    queries: {
      ...data.queryClient.getDefaultOptions().queries,
      gcTime: Infinity,
    },
  });
  const tree = () => (
    <SessionProvider manager={manager}>
      <DataProvider layer={data}>
        <ThemeContext.Provider value={mode}>
          <SearchScreen />
        </ThemeContext.Provider>
      </DataProvider>
    </SessionProvider>
  );
  const view = await render(tree());
  await act(() => focusManager.setFocused(true));
  return {
    requests,
    manager,
    data,
    rerender: () => view.rerender(tree()),
    dispose: async () => {
      await view.unmount();
      data.dispose();
      manager.dispose();
    },
  };
}
const input = () =>
  screen.getByLabelText('Search workspaces, boards and cards');
const enter = async (text) => {
  await fireEvent.changeText(input(), text);
  await fireEvent(input(), 'submitEditing');
};
afterEach(() => {
  onlineManager.setOnline(true);
  focusManager.setFocused(true);
  jest.useRealTimers();
});

test('blank native Search has real type shortcuts, no network, no history or unsupported filters', async () => {
  const env = await setup();
  try {
    expect(input().props.autoFocus).toBe(true);
    expect(
      screen.getByText('Find workspaces, boards and cards you can access.'),
    ).toBeTruthy();
    expect(screen.queryByText(/Recent|Trending|Search filters/)).toBeNull();
    await fireEvent.changeText(input(), '   ');
    expect(
      env.requests.filter((r) => r.url.pathname === '/api/search'),
    ).toHaveLength(0);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Try searching Cards' }),
    );
    expect(
      screen.getByRole('button', { name: 'Cards' }).props.accessibilityState
        .selected,
    ).toBe(true);
  } finally {
    await env.dispose();
  }
});
test('Return submits immediately, renders server groups and opens a canonical guarded Card', async () => {
  const env = await setup();
  try {
    await enter(' design ');
    await screen.findByText('Design card');
    expect(screen.getByRole('button', { name: 'All · 3' })).toBeTruthy();
    const search = env.requests.find(
      (r) => r.url.pathname === '/api/search',
    ).url;
    expect(search.searchParams.has('page')).toBe(false);
    expect(search.searchParams.get('limit')).toBe('5');
    await fireEvent.press(
      screen.getByRole('button', { name: 'Open Design card, Design board' }),
    );
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(cardHit.path),
    );
  } finally {
    await env.dispose();
  }
});
