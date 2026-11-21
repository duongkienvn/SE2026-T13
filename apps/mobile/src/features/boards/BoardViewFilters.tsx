import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { KanbanFilters } from './kanban-api';

export type CalendarViewState = {
  view: 'month' | 'week';
  selectedDay: string | null;
  scroll: { month: number; week: number };
};
const Context = createContext<{
  values: Record<string, KanbanFilters>;
  update: (boardId: string, filters: KanbanFilters) => void;
  calendars: Map<string, CalendarViewState>;
} | null>(null);

/** Ephemeral IDs/query only. Private navigation remounts this owner per session. */
export function BoardViewFiltersProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [values, setValues] = useState<Record<string, KanbanFilters>>({});
  // IDs/civil dates/offsets only, never Card payloads. Same private-session owner.
  const calendars = useRef(new Map<string, CalendarViewState>()).current;
  return (
    <Context.Provider
      value={{
        values,
        calendars,
        update: (boardId, filters) =>
          setValues((current) => ({ ...current, [boardId]: filters })),
      }}
    >
      {children}
    </Context.Provider>
  );
}

/** Shared route restoration survives a Calendar unmount, not a session remount. */
export function useCalendarViewState(boardId: string) {
  const context = useContext(Context);
  const local = useRef(new Map<string, CalendarViewState>()).current;
  const values = context?.calendars ?? local;
  let value = values.get(boardId);
  if (!value) {
    value = { view: 'month', selectedDay: null, scroll: { month: 0, week: 0 } };
    values.set(boardId, value);
  }
  return value;
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
