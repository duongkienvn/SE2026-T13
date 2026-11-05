import type { GlobalSearchItem } from '@kanban/shared';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { Dialog } from '../../components/Dialog';
import {
  CheckSquareIcon,
  CloseIcon,
  ColumnsIcon,
  LayersIcon,
} from '../../components/icons';
import type { SearchView } from './api';
import { useSearch } from './hooks';

const sections: { key: SearchView; label: string; icon: typeof LayersIcon }[] =
  [
    { key: 'workspaces', label: 'Workspaces', icon: LayersIcon },
    { key: 'boards', label: 'Boards', icon: ColumnsIcon },
    { key: 'cards', label: 'Cards', icon: CheckSquareIcon },
  ];
const resultKey = (item: GlobalSearchItem) => `${item.type}:${item.id}`;

export function SearchPalette({ onClose }: { onClose: () => void }) {
  const [input, setInput] = useState('');
  const [composing, setComposing] = useState(false);
  const [type, setType] = useState<'all' | SearchView>('all');
  const [page, setPage] = useState(1);
  const [activeKey, setActiveKey] = useState<string>();
  const loadingPage = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const navigate = useNavigate();
  const search = useSearch(composing ? '' : input, type, page);
  useEffect(() => {
    if (search.error || (!search.loading && search.data.length >= page))
      loadingPage.current = false;
  }, [search.loading, search.error, search.data.length, page]);
  const groups = sections
    .filter((section) => type === 'all' || type === section.key)
    .map((section) => {
      const pages = search.data.map((result) => result.groups[section.key]);
      const seen = new Set<string>();
      const items: GlobalSearchItem[] = [];
      for (const group of pages)
        for (const item of group.items) {
          const key = `${item.type}:${item.id}`;
          if (!seen.has(key)) {
            seen.add(key);
            items.push(item);
          }
        }
      return {
        ...section,
        items,
        total: pages.at(-1)?.total ?? 0,
        hasMore: pages.at(-1)?.hasMore ?? false,
      };
    });
  const rows = groups.flatMap((group) => group.items);
  const active = rows.findIndex((item) => resultKey(item) === activeKey);
  useEffect(() => {
    if (active === -1 && activeKey !== undefined) setActiveKey(undefined);
  }, [active, activeKey]);
  const activeId =
    active >= 0 && rows[active]
      ? `${id}-option-${rows[active].type}-${rows[active].id}`
      : undefined;
  useEffect(() => {
    if (activeId)
      document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);
  const select = (item: GlobalSearchItem) => {
    // Accept only same-origin relative routes; the server supplies the path.
    if (
      !item.path.startsWith('/') ||
      item.path.startsWith('//') ||
      item.path.includes('\\')
    )
      return;
    onClose();
    navigate(item.path);
  };
  const changeView = (next: 'all' | SearchView) => {
    loadingPage.current = false;
    setType(next);
    setPage(1);
    setActiveKey(undefined);
    inputRef.current?.focus();
  };
  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) {
      if (event.key === 'Escape') event.stopPropagation();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (rows.length)
        setActiveKey((key) => {
          const index = rows.findIndex((item) => resultKey(item) === key);
          const next =
            event.key === 'ArrowDown'
              ? (index + 1) % rows.length
              : index <= 0
                ? rows.length - 1
                : index - 1;
          return resultKey(rows[next]);
        });
    } else if (event.key === 'Enter' && active >= 0 && rows[active]) {
      event.preventDefault();
      select(rows[active]);
    }
  };
  const status = search.tooLong
    ? 'Search is limited to 120 characters.'
    : search.loading
      ? 'Searching…'
      : search.error
        ? 'Search unavailable.'
        : input.trim() && search.data.length
          ? groups.map((group) => `${group.label}: ${group.total}`).join('. ')
          : '';

  return (
    <Dialog
      open
      onClose={onClose}
      title="Search Kanvexa"
      headerActions={
        <button
          type="button"
          aria-label="Close search"
          onClick={onClose}
          className="grid size-10 place-items-center rounded-lg text-muted hover:bg-app focus-visible:outline-2 focus-visible:outline-primary"
        >
          <CloseIcon className="size-5" />
        </button>
      }
    >
      <div className="flex items-center gap-2 rounded-xl border border-line bg-app px-3 focus-within:outline-2 focus-within:outline-primary">
        <input
          ref={inputRef}
          data-autofocus
          role="combobox"
          aria-label="Search workspaces, boards and cards"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          value={input}
          onChange={(event) => {
            loadingPage.current = false;
            setInput(event.target.value);
            setPage(1);
            setActiveKey(undefined);
          }}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onKeyDown={onInputKeyDown}
          placeholder="Search workspaces, boards and cards"
          className="min-h-12 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
        />
        {input && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              loadingPage.current = false;
              setInput('');
              setPage(1);
              setActiveKey(undefined);
              inputRef.current?.focus();
            }}
            className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface focus-visible:outline-2 focus-visible:outline-primary"
          >
            <CloseIcon className="size-4" />
          </button>
        )}
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      {type !== 'all' && (
        <button
          type="button"
          onClick={() => changeView('all')}
          className="mt-4 text-sm font-medium text-primary focus-visible:outline-2 focus-visible:outline-primary"
        >
          ← Back to all
        </button>
      )}
      {!input.trim() && (
        <p className="py-10 text-center text-sm text-muted">
          Start typing to search your workspaces, boards and cards.
        </p>
      )}
      {search.tooLong && <p className="py-6 text-sm text-muted">{status}</p>}
      {search.loading && !search.data.length && (
        <div
          aria-hidden="true"
          className="space-y-3 py-6 motion-safe:animate-pulse"
        >
          <div className="h-4 w-28 rounded bg-app" />
          <div className="h-12 rounded-lg bg-app" />
          <div className="h-12 rounded-lg bg-app" />
        </div>
      )}
      {search.error && (
        <div className="py-6 text-sm text-muted">
          <p>
            {search.data.length
              ? 'Could not refresh search. Your previous results are still available.'
              : typeof navigator !== 'undefined' && !navigator.onLine
                ? 'You are offline. Check your connection and try again.'
                : 'Search is unavailable. Please try again.'}
          </p>
          <button
            type="button"
            onClick={() => {
              inputRef.current?.focus();
              search.retry();
            }}
            className="mt-3 font-medium text-primary focus-visible:outline-2 focus-visible:outline-primary"
          >
            Try again
          </button>
        </div>
      )}
      {!search.loading &&
        !search.error &&
        !!search.data.length &&
        !rows.length && (
          <p className="py-10 text-center text-sm text-muted">
            No results. Try a different search.
          </p>
        )}
      <div
        id={`${id}-list`}
        role="listbox"
        aria-label="Search results"
        className="mt-3 max-h-[50dvh] overflow-y-auto"
      >
        {groups.map((group) => (
          <div
            key={group.key}
            role="group"
            aria-label={group.label}
            className="py-2"
          >
            {!!search.data.length && (
              <div
                aria-hidden="true"
                className="flex items-center justify-between gap-2 px-2 py-2"
              >
                <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">
                  {group.label}{' '}
                  <span className="font-normal">{group.total}</span>
                </h3>
              </div>
            )}
            {group.items.map((item) => {
              const index = rows.indexOf(item);
              return (
                <div
                  key={`${item.type}:${item.id}`}
                  id={`${id}-option-${item.type}-${item.id}`}
                  role="option"
                  aria-selected={active === index}
                  onMouseMove={() => setActiveKey(resultKey(item))}
                  onClick={() => select(item)}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 ${active === index ? 'bg-primary-soft' : 'hover:bg-app'}`}
                >
                  <span
                    aria-hidden="true"
                    className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary"
                  >
                    <group.icon className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">
                      {item.title}
                    </span>
                    {item.subtitle && (
                      <span className="block truncate text-xs text-muted">
                        {item.subtitle}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {type === 'all' &&
        groups.some((group) => group.total > group.items.length) && (
          <div className="flex flex-wrap gap-3 border-t border-line pt-3">
            {groups
              .filter((group) => group.total > group.items.length)
              .map((group) => (
                <button
                  key={group.key}
                  type="button"
                  onClick={() => changeView(group.key)}
                  className="text-xs font-medium text-primary focus-visible:outline-2 focus-visible:outline-primary"
                >
                  See all {group.label}
                </button>
              ))}
          </div>
        )}
      {type !== 'all' &&
        groups[0]?.hasMore &&
        !search.loading &&
        !search.error && (
          <button
            type="button"
            onClick={() => {
              if (loadingPage.current) return;
              loadingPage.current = true;
              setPage((current) => current + 1);
              inputRef.current?.focus();
            }}
            className="mt-3 w-full rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-primary hover:bg-app focus-visible:outline-2 focus-visible:outline-primary"
          >
            Load more
          </button>
        )}
    </Dialog>
  );
}
