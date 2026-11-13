import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSessionSnapshot } from '../../infrastructure/auth/SessionProvider';
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
  remember(id: ResourceId | null): void;
} | null>(null);

function WorkspacePreference({
  identity,
  children,
}: {
  identity: SessionIdentity;
  children: ReactNode;
}) {
  const [preferred, remember] = useState<ResourceId | null>(null);
  return (
    <SelectionContext.Provider value={{ identity, preferred, remember }}>
      {children}
    </SelectionContext.Provider>
  );
}

/** Own only the selection ID. QueryClient remains the owner of all server data. */
export function WorkspaceSelectionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const session = useSessionSnapshot();
  if (session.status !== 'authenticated')
    return (
      <SelectionContext.Provider value={null}>
        {children}
      </SelectionContext.Provider>
    );
  return (
    <WorkspacePreference
      key={`${session.generation}:${session.user.id}`}
      identity={{ userId: session.user.id, generation: session.generation }}
    >
      {children}
    </WorkspacePreference>
  );
}

/** Only call from a verified subtree of WorkspaceSelectionProvider. */
export function useSelectedWorkspace(active = true) {
  const selection = useContext(SelectionContext);
  if (!selection)
    throw new Error('Workspace selection requires a verified session');
  const { identity, preferred, remember } = selection;
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
      selected?.id !== preferred
    )
      remember(null);
  }, [preferred, selected?.id, directory.data, data, identity, remember]);

  function setSelectedId(value: string): boolean {
    const id = workspaceId(value);
    if (!id || !sameIdentity(identity, data.getIdentity()) || !readable(id))
      return false;
    const current = data.queryClient.getQueryData(options.queryKey);
    if (!current?.some((row) => row.id === id)) return false;
    const previous = resolveWorkspace(current, preferred, readable);
    if (previous && previous.id !== id) {
      const keys = [
        queryKeys.workspace(identity, previous.id),
        queryKeys.workspaceBoards(identity, previous.id),
      ];
      for (const key of keys) {
        data.cancelResourceRequests(key);
        void data.queryClient.cancelQueries({ queryKey: key });
      }
    }
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
