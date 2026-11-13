import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  useSessionManager,
  useSessionSnapshot,
} from '../../infrastructure/auth/SessionProvider';
import {
  sameIdentity,
  type SessionIdentity,
} from '../../infrastructure/api/session-client';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { queryKeys } from '../../infrastructure/query/keys';
import type { ResourceId } from '../../navigation/routes';
import { workspaceId } from './decoder';
import { workspaceDirectoryOptions } from './queries';
import { resolveWorkspace } from './selection';

const SelectionContext = createContext<{
  identity: SessionIdentity;
  preferred: ResourceId | null;
  currentPreference(): ResourceId | null;
  remember(id: ResourceId | null): void;
} | null>(null);

/** Own only the selection ID. QueryClient remains the owner of all server data. */
export function WorkspaceSelectionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const session = useSessionSnapshot();
  const manager = useSessionManager();
  const preference = useRef<{
    identity: SessionIdentity;
    id: ResourceId;
  } | null>(null);
  const [, update] = useState(0);
  useEffect(
    () =>
      manager.addLifecycleListener({
        onSessionEnd() {
          preference.current = null;
        },
      }),
    [manager],
  );
  const identity =
    session.status === 'authenticated'
      ? { userId: session.user.id, generation: session.generation }
      : null;
  const currentPreference = () =>
    sameIdentity(preference.current?.identity ?? null, identity)
      ? (preference.current?.id ?? null)
      : null;
  const value = identity
    ? {
        identity,
        preferred: currentPreference(),
        currentPreference,
        remember(id: ResourceId | null) {
          preference.current = id ? { identity, id } : null;
          update((revision) => revision + 1);
        },
      }
    : null;
  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
}

/** Only call from a verified subtree of WorkspaceSelectionProvider. */
export function useSelectedWorkspace(active = true) {
  const selection = useContext(SelectionContext);
  if (!selection)
    throw new Error('Workspace selection requires a verified session');
  const { identity, preferred, remember, currentPreference } = selection;
  const data = useMobileData();
  const options = workspaceDirectoryOptions(data, identity);
  const directory = useQuery({ ...options, enabled: active });
  const readable = (id: ResourceId) =>
    data.resources.readable(queryKeys.workspace(identity, id));
  const selected = resolveWorkspace(directory.data, preferred, readable);
  useEffect(() => {
    if (
      preferred &&
      (directory.data ||
        !data.resources.readable(queryKeys.workspace(identity, preferred))) &&
      selected?.id !== preferred &&
      currentPreference() === preferred
    )
      remember(null);
  }, [
    preferred,
    selected?.id,
    directory.data,
    data,
    identity,
    remember,
    currentPreference,
  ]);

  function cancelSelectionWork(id: ResourceId) {
    const keys = [
      queryKeys.workspace(identity, id),
      queryKeys.workspaceBoards(identity, id),
    ];
    for (const key of keys) {
      data.cancelResourceRequests(key);
      void data.queryClient.cancelQueries({ queryKey: key });
    }
  }

  function setSelectedId(value: string): boolean {
    const id = workspaceId(value);
    if (!id || !sameIdentity(identity, data.getIdentity()) || !readable(id))
      return false;
    const current = data.queryClient.getQueryData(options.queryKey);
    if (!current?.some((row) => row.id === id)) return false;
    const previous = resolveWorkspace(current, currentPreference(), readable);
    if (previous && previous.id !== id) cancelSelectionWork(previous.id);
    remember(id);
    return true;
  }

  return {
    identity,
    selected,
    selectedId: selected?.id ?? null,
    workspaces: directory.data?.filter((row) => readable(row.id)),
    setSelectedId,
    directory,
  };
}
