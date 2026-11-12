import { NavigationRoot } from '../../../src/app/_layout';
import type {
  SessionAdapter,
  SessionState,
} from '../../../src/navigation/session';

// Device test only; this gallery directory is excluded from production bundles.
const snapshot: SessionState = {
  status: 'authenticated',
  sessionKey: 'device-test',
};
const adapter: SessionAdapter = {
  getSnapshot: () => snapshot,
  subscribe: () => () => {},
};

export default function TestLayout() {
  return <NavigationRoot adapter={adapter} />;
}
