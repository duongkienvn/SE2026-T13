/* global jest, test, expect, afterEach */
import { render, screen, fireEvent } from '@testing-library/react-native';
import { PushControls } from '../src/features/push/context';

function controller(patch = {}) {
  const state = {
    preferences: { enabled: false, deliveryAvailable: true },
    capability: 'ready',
    eligible: false,
    busy: false,
    online: true,
    uncertain: false,
    ...patch,
  };
  return {
    getSnapshot: () => state,
    subscribe: () => () => {},
    enable: jest.fn(),
    disable: jest.fn(),
    reconcile: jest.fn(),
  };
}
afterEach(() => jest.clearAllMocks());
test('push account control explicitly enables and identifies immediate saving', async () => {
  const c = controller();
  await render(<PushControls controller={c} />);
  await fireEvent(
    screen.getByRole('switch', { name: 'Push notifications' }),
    'valueChange',
    true,
  );
  expect(c.enable).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/Push changes save immediately/)).toBeTruthy();
});
test('Expo Go and feature off are truthful disabled enable states', async () => {
  const c = controller({ capability: 'needs-build' });
  const view = await render(<PushControls controller={c} />);
  expect(screen.getByRole('switch')).toBeDisabled();
  expect(screen.getByText(/Needs development build/)).toBeTruthy();
  await view.rerender(
    <PushControls
      controller={controller({
        preferences: { enabled: false, deliveryAvailable: false },
      })}
    />,
  );
  expect(screen.getByRole('switch')).toBeDisabled();
  expect(screen.getByText(/disabled on this server/)).toBeTruthy();
});
test('account enabled elsewhere shows denied status and explicit device action', async () => {
  const c = controller({
    preferences: { enabled: true, deliveryAvailable: true },
    permission: 'denied',
  });
  await render(<PushControls controller={c} />);
  expect(screen.getByText(/Permission denied/)).toBeTruthy();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Enable on this device' }),
  );
  expect(c.enable).toHaveBeenCalled();
  await fireEvent(screen.getByRole('switch'), 'valueChange', false);
  expect(c.disable).toHaveBeenCalled();
});
test('uncertain or offline state blocks writes and retains a read-only check', async () => {
  await render(<PushControls controller={controller({ uncertain: true })} />);
  expect(screen.getByRole('switch')).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Check push values' }),
  ).toBeEnabled();
  expect(screen.getByText(/Checking server values cannot prove/)).toBeTruthy();
});
