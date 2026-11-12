import type { BoardExportFormat } from '@kanban/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import {
  ChevronDownIcon,
  ColumnsIcon,
  FileIcon,
  TableIcon,
  type IconProps,
} from '../../../components/icons';
import { boardKeys } from '../../boards/query-keys';
import { exportBoardDataAsync } from './async-export-api';
import { useAuthSession } from '../../auth/auth-session-context';
import { isApiError } from '../../../lib/api-client';
import { ExportAction, ExportCard } from './ExportCard';
import {
  exportableBoardLabel,
  useExportableBoards,
  type ExportableBoard,
} from './owned-boards';
import { useExportDownload } from './useExportDownload';

const FORMATS: {
  value: BoardExportFormat;
  label: string;
  description: string;
  icon: ComponentType<IconProps>;
}[] = [
  {
    value: 'json',
    label: 'JSON',
    description: 'Full structure (recommended)',
    icon: FileIcon,
  },
  {
    value: 'csv',
    label: 'CSV',
    description: 'One row per card (spreadsheets)',
    icon: TableIcon,
  },
];

const fieldLabel = 'block text-sm font-semibold text-ink';

/** OWNER-only Board snapshot in JSON or CSV (#216), archived Boards included. */
export function BoardExportCard() {
  const { boards, isError, retry } = useExportableBoards();
  const queryClient = useQueryClient();
  const download = useExportDownload();
  const scope = useAuthSession();
  const operation = useRef<{
    boardId: string;
    format: BoardExportFormat;
    generation: number;
    key: string;
  } | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [format, setFormat] = useState<BoardExportFormat>('json');

  // A selection is valid only while the Board is still in the owner list;
  // after revocation or demotion it disappears instead of lingering.
  const selected = boards?.find((board) => board.id === selectedId) ?? null;
  const ownedIds = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    ownedIds.current = new Set(boards?.map((board) => board.id) ?? []);
  }, [boards]);

  const exportSelected = (board: ExportableBoard) => {
    const chosenFormat = format;
    if (
      !operation.current ||
      operation.current.boardId !== board.id ||
      operation.current.format !== chosenFormat ||
      operation.current.generation !== scope.generation
    )
      operation.current = {
        boardId: board.id,
        format: chosenFormat,
        generation: scope.generation,
        key: crypto.randomUUID(),
      };
    const current = operation.current;
    void download.start({
      target: { kind: 'board', boardId: board.id, format: chosenFormat },
      request: async (token, signal, onPhase) => {
        try {
          const result = await exportBoardDataAsync(
            token,
            board.id,
            chosenFormat,
            current.key,
            signal,
            onPhase,
          );
          if (operation.current === current) operation.current = null;
          return result;
        } catch (error) {
          if (
            isApiError(error) &&
            (error.status === 410 || error.code === 'EXPORT_RETRY_EXHAUSTED') &&
            operation.current === current
          )
            operation.current = null;
          throw error;
        }
      },
      stillAllowed: () => ownedIds.current.has(board.id),
      onAccessLost: () => {
        setSelectedId('');
        void queryClient.invalidateQueries({ queryKey: boardKeys.lists() });
      },
    });
  };

  const exporting = download.isExporting;

  return (
    <ExportCard
      id="board-export"
      title="Export board data"
      description="A board you own with its lists, cards, labels, members, checklists and comments."
      icon={ColumnsIcon}
    >
      <div>
        <label htmlFor="board-export-board" className={fieldLabel}>
          Board
        </label>
        {isError ? (
          <div className="mt-1.5 space-y-2">
            <Alert variant="error">Could not load your boards.</Alert>
            <Button variant="secondary" size="sm" onClick={retry}>
              Try again
            </Button>
          </div>
        ) : (
          <>
            <div className="relative mt-1.5">
              <ColumnsIcon
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 size-4.5 -translate-y-1/2 text-muted"
              />
              <select
                id="board-export-board"
                value={selected ? selected.id : ''}
                disabled={!boards || boards.length === 0 || exporting}
                aria-describedby={
                  boards && boards.length === 0
                    ? 'board-export-empty'
                    : undefined
                }
                onChange={(event) => {
                  setSelectedId(event.target.value);
                  operation.current = null;
                  download.reset();
                }}
                className="h-11 w-full appearance-none rounded-lg border border-line bg-surface pr-10 pl-10 text-sm text-ink focus:border-primary focus:ring-3 focus:ring-primary/15 focus:outline-none disabled:cursor-not-allowed disabled:text-muted"
              >
                <option value="" disabled>
                  {!boards
                    ? 'Loading your boards…'
                    : boards.length === 0
                      ? 'No boards to export'
                      : 'Choose a board you own'}
                </option>
                {boards?.map((board) => (
                  <option key={board.id} value={board.id}>
                    {exportableBoardLabel(board)}
                  </option>
                ))}
              </select>
              <ChevronDownIcon
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 right-3 size-4.5 -translate-y-1/2 text-muted"
              />
            </div>
            {boards && boards.length === 0 && (
              <p id="board-export-empty" className="mt-1.5 text-sm text-muted">
                You don’t own any boards yet. Only a board owner can export a
                board; ask an owner if you need a copy.
              </p>
            )}
          </>
        )}
      </div>

      <fieldset disabled={exporting}>
        <legend className={fieldLabel}>Export format</legend>
        <div className="mt-1.5 grid gap-3 lg:grid-cols-2">
          {FORMATS.map(({ value, label, description, icon: Icon }) => {
            const checked = format === value;
            return (
              <label
                key={value}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-2.5 transition-colors has-[:disabled]:cursor-not-allowed has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary ${
                  checked
                    ? 'border-primary bg-primary-soft'
                    : 'border-line hover:bg-app'
                }`}
              >
                <input
                  type="radio"
                  name="board-export-format"
                  value={value}
                  checked={checked}
                  onChange={() => {
                    setFormat(value);
                    operation.current = null;
                    download.reset();
                  }}
                  className="mt-0.5 size-4.5 shrink-0 accent-primary"
                />
                <Icon
                  aria-hidden="true"
                  className={`mt-px size-5 shrink-0 ${checked ? 'text-primary' : 'text-muted'}`}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">
                    {label}
                  </span>
                  <span className="block text-sm text-muted">
                    {description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <ExportAction
        label="Export board data"
        state={download.state}
        disabled={!selected}
        onClick={() => {
          if (selected) exportSelected(selected);
        }}
      />
    </ExportCard>
  );
}
