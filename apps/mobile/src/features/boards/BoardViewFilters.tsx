import { createContext, useContext, useState, type ReactNode } from 'react';
import type { KanbanFilters } from './kanban-api';

const Context = createContext<{
  values: Record<string, KanbanFilters>;
  update: (boardId: string, filters: KanbanFilters) => void;
} | null>(null);

/** Ephemeral IDs/query only. Private navigation remounts this owner per session. */
export function BoardViewFiltersProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [values, setValues] = useState<Record<string, KanbanFilters>>({});
  return (
    <Context.Provider
      value={{
        values,
        update: (boardId, filters) =>
          setValues((current) => ({ ...current, [boardId]: filters })),
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useBoardViewFilters(boardId: string) {
  const context = useContext(Context);
  // Standalone component harnesses can mount a Board without the route owner.
  const [local, setLocal] = useState<KanbanFilters>({});
  return [
    context?.values[boardId] ?? local,
    context
      ? (filters: KanbanFilters) => context.update(boardId, filters)
      : setLocal,
  ] as const;
}
