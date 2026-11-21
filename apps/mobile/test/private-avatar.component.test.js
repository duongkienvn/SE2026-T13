/* global jest, test, expect */
import { act, render, screen } from '@testing-library/react-native';
import { PrivateAvatar } from '../src/features/profile/PrivateAvatar';
import { USER_A, USER_B } from './auth/support';
const mockDispose = jest.fn(),
  mockBinary = jest.fn();
const mockData = { assertCurrent: () => {}, api: { binary: mockBinary } };
jest.mock('../src/infrastructure/query/DataProvider', () => ({
  useMobileData: () => mockData,
}));
jest.mock('../src/features/profile/native-media', () => ({
  savePrivateAvatar: () => ({
    uri: 'file:///private/avatar.webp',
    dispose: mockDispose,
  }),
}));
const identity = { userId: USER_A, generation: 2 };
const profile = {
  displayName: 'Alex User',
  avatarRevision: 1,
  avatarUrl: `/users/${USER_A}/avatar/${USER_B}`,
};
test('private image loads only from authenticated bounded transport and disposes temporary file', async () => {
  mockBinary.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]).buffer });
  mockDispose.mockClear();
  const view = await render(
    <PrivateAvatar profile={profile} identity={identity} />,
  );
  expect(mockBinary).toHaveBeenCalledWith(
    profile.avatarUrl,
    ['image/webp'],
    expect.objectContaining({
      identity,
      maximumBytes: 1048576,
      requireContentLength: true,
    }),
  );
  expect(view.toJSON()).toEqual(
    expect.objectContaining({
      children: expect.arrayContaining([
        expect.objectContaining({
          type: 'Image',
          props: expect.objectContaining({
            source: expect.objectContaining({
              uri: 'file:///private/avatar.webp',
            }),
          }),
        }),
      ]),
    }),
  );
  await view.unmount();
  expect(mockDispose).toHaveBeenCalledTimes(1);
});
test('unknown legacy source stays initials-only and stale revision bytes are never saved', async () => {
  mockBinary.mockClear();
  let finish;
  mockBinary.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = await render(
    <PrivateAvatar profile={profile} identity={identity} />,
  );
  await view.rerender(
    <PrivateAvatar
      profile={{
        ...profile,
        avatarRevision: 2,
        avatarUrl: 'https://attacker.test/private.png',
      }}
      identity={identity}
    />,
  );
  await act(() => finish({ bytes: new Uint8Array([1, 2, 3]).buffer }));
  expect(screen.queryByText('AU')).toBeTruthy();
  expect(JSON.stringify(view.toJSON())).not.toContain('attacker.test');
  await view.unmount();
});
test('manual profile revalidation retries an unavailable private image at the same revision', async () => {
  mockBinary.mockClear();
  mockBinary
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]).buffer });
  const view = await render(
    <PrivateAvatar profile={profile} identity={identity} refreshKey={1} />,
  );
  expect(screen.queryByText('AU')).toBeTruthy();
  await view.rerender(
    <PrivateAvatar profile={profile} identity={identity} refreshKey={2} />,
  );
  expect(mockBinary).toHaveBeenCalledTimes(2);
  await view.unmount();
});
