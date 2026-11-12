/* global jest, test, expect */
import * as Linking from 'expo-linking';
import { getLinkingConfig } from 'expo-router/build/getLinkingConfig';
import { subscribe as subscribeNativeEvents } from 'expo-router/build/link/linking';
import { redirectSystemPath } from '../src/app/+native-intent';
import { subscribeIncomingLinks } from '../src/navigation/incoming-link';

jest.mock('expo-linking', () => ({
  __esModule: true,
  addEventListener: jest.fn(),
}));
jest.mock('expo', () => ({ Platform: { OS: 'android' } }));

test('only validated warm intents notify active subscribers and cleanup stops delivery', () => {
  const received = [];
  const unsubscribe = subscribeIncomingLinks((destination) =>
    received.push(destination),
  );
  expect(
    redirectSystemPath({ path: 'kanvexa-dev://search', initial: true }),
  ).toBe('/search');
  expect(
    redirectSystemPath({ path: 'https://evil.example/search', initial: false }),
  ).toBe('/');
  expect(received).toEqual([]);
  expect(
    redirectSystemPath({ path: 'kanvexa-dev://search', initial: false }),
  ).toBe('/search');
  expect(received).toEqual([{ kind: 'screen', screen: 'search' }]);
  unsubscribe();
  redirectSystemPath({ path: 'kanvexa-dev://invitation', initial: false });
  expect(received).toHaveLength(1);
});

test('Expo Router validates and memoizes a cold native URL before routing', async () => {
  const redirect = jest.fn(redirectSystemPath);
  const context = () => ({ redirectSystemPath: redirect });
  context.keys = () => ['./+native-intent.tsx'];
  const configFor = (serverUrl) =>
    getLinkingConfig(null, context, { serverUrl, skipGenerated: true });
  const valid = configFor('kanvexa-dev://search');

  expect(valid.getInitialURL()).toBe('/search');
  expect(valid.getInitialURL()).toBe('/search');
  expect(redirect).toHaveBeenCalledTimes(1);
  expect(redirect).toHaveBeenCalledWith({
    path: 'kanvexa-dev://search',
    initial: true,
  });
  const asyncUrl = Promise.resolve('https://evil.example/search');
  expect(await configFor(asyncUrl).getInitialURL()).toBe('/');
});

test('Expo Router delivers native URL events through the validated intent handler', async () => {
  let onUrl;
  const remove = jest.fn();
  Linking.addEventListener.mockImplementation((event, listener) => {
    expect(event).toBe('url');
    onUrl = listener;
    return { remove };
  });
  const received = [];
  const forwarded = [];
  const unsubscribeTargets = subscribeIncomingLinks((destination) =>
    received.push(destination),
  );
  const unsubscribeEvents = subscribeNativeEvents({ redirectSystemPath })(
    (path) => forwarded.push(path),
  );

  await onUrl({ url: 'kanvexa-dev://search' });
  await onUrl({ url: 'https://evil.example/invitation' });
  expect(forwarded).toEqual(['/search', '/']);
  expect(received).toEqual([{ kind: 'screen', screen: 'search' }]);

  unsubscribeEvents();
  unsubscribeTargets();
  expect(remove).toHaveBeenCalledTimes(1);
});
