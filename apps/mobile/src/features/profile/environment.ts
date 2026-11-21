import { focusManager } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useSyncExternalStore } from 'react';
import { useWorkspaceOnline } from '../workspaces/status';
const subscribe = focusManager.subscribe.bind(focusManager);
const snapshot = () => focusManager.isFocused();
export function useAccountEnvironment() {
  const focused = useIsFocused(),
    foreground = useSyncExternalStore(subscribe, snapshot),
    online = useWorkspaceOnline();
  return { online, eligible: focused && foreground && online };
}
