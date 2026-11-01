import { useState, type FormEvent, type ReactNode } from 'react';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { TextField } from '../../../components/TextField';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckSquareIcon,
  PencilIcon,
  PlusIcon,
  SpinnerIcon,
  TrashIcon,
} from '../../../components/icons';
import { isApiError } from '../../../lib/api-client';
import { useReportDirty } from '../card-draft';
import {
  CardDetailSection,
  sectionActionClass,
} from '../components/detail/CardDetailSection';
import {
  CHECKLIST_ITEM_MAX_LENGTH,
  CHECKLIST_TITLE_MAX_LENGTH,
  type Checklist,
  type ChecklistAction,
  type ChecklistItem,
} from './api';
import {
  checklistErrorMessage,
  useChecklistAction,
  useChecklists,
} from './hooks';

interface CardChecklistsProps {
  boardId: string;
  cardId: string;
  readOnly: boolean;
}

const iconButton =
  'grid size-9 shrink-0 place-items-center rounded-md text-muted hover:bg-app hover:text-ink focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40';

function validate(value: string, max: number, what: string) {
  const text = value.trim();
  if (!text) return `Enter ${what}.`;
  if (text.length > max) return `Use at most ${max} characters.`;
  return undefined;
}

/** Text input with Save/Cancel; reports unsent text to the leave guard. */
function InlineTextForm({
  label,
  initial = '',
  max,
  what,
  submitLabel,
  keepOpen = false,
  onSubmit,
  onCancel,
}: {
  label: string;
  initial?: string;
  max: number;
  what: string;
  submitLabel: string;
  /** Clears and stays open after saving, for adding several in a row. */
  keepOpen?: boolean;
  onSubmit: (text: string) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  useReportDirty(value.trim() !== initial.trim());

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const invalid = validate(value, max, what);
    setError(invalid);
    if (invalid) return;
    if (value.trim() === initial.trim()) {
      onCancel();
      return;
    }
    setPending(true);
    try {
      await onSubmit(value.trim());
      if (keepOpen) setValue('');
      else onCancel();
    } catch (failure) {
      // The text stays so nothing typed is lost.
      setError(checklistErrorMessage(failure));
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      className="space-y-2"
    >
      <TextField
        label={label}
        autoFocus
        value={value}
        error={error}
        onChange={(event) => setValue(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !pending) {
            // Close this field only, not the whole card.
            event.stopPropagation();
            event.nativeEvent.stopImmediatePropagation();
            onCancel();
          }
        }}
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ProgressBar({ checklist }: { checklist: Checklist }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-10 shrink-0 text-xs font-medium text-muted tabular-nums">
        {Math.round(checklist.completionPercentage)}%
      </span>
      <div
        role="progressbar"
        aria-label={`${checklist.title} progress`}
        aria-valuemin={0}
        aria-valuemax={checklist.totalItems}
        aria-valuenow={checklist.checkedItems}
        aria-valuetext={`${checklist.checkedItems} of ${checklist.totalItems} done`}
        className="h-2 flex-1 overflow-hidden rounded-full bg-app"
      >
        <div
          className={`h-full rounded-full transition-[width] motion-reduce:transition-none ${
            checklist.totalItems > 0 &&
            checklist.checkedItems === checklist.totalItems
              ? 'bg-success'
              : 'bg-primary'
          }`}
          style={{ width: `${checklist.completionPercentage}%` }}
        />
      </div>
    </div>
  );
}

function ItemRow({
  item,
  index,
  items,
  readOnly,
  run,
}: {
  item: ChecklistItem;
  index: number;
  items: ChecklistItem[];
  readOnly: boolean;
  run: (action: ChecklistAction) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const base = { checklistId: item.checklistId, itemId: item.id };
  if (editing && !readOnly)
    return (
      <li className="py-1">
        <InlineTextForm
          label="Item text"
          initial={item.text}
          max={CHECKLIST_ITEM_MAX_LENGTH}
          what="the item text"
          submitLabel="Save"
          onSubmit={(text) => run({ type: 'editItem', ...base, text })}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  return (
    <li className="group flex min-h-10 items-center gap-2 rounded-md hover:bg-app/60">
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-1.5 has-disabled:cursor-default">
        <input
          type="checkbox"
          className="size-4 shrink-0 accent-[var(--color-primary-solid)]"
          checked={item.isChecked}
          disabled={readOnly}
          onChange={(event) =>
            void run({
              type: 'toggleItem',
              ...base,
              isChecked: event.currentTarget.checked,
            }).catch(() => undefined)
          }
        />
        <span
          className={`min-w-0 text-sm break-words ${
            item.isChecked ? 'text-muted line-through' : 'text-ink'
          }`}
        >
          {item.text}
        </span>
      </label>
      {!readOnly && (
        <div className="flex shrink-0 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          <button
            type="button"
            aria-label={`Edit ${item.text}`}
            className={iconButton}
            onClick={() => setEditing(true)}
          >
            <PencilIcon aria-hidden="true" className="size-4" />
          </button>
          <button
            type="button"
            aria-label={`Move ${item.text} up`}
            className={iconButton}
            disabled={index === 0}
            onClick={() =>
              void run({
                type: 'moveItem',
                ...base,
                beforeItemId: items[index - 1].id,
              }).catch(() => undefined)
            }
          >
            <ArrowUpIcon aria-hidden="true" className="size-4" />
          </button>
          <button
            type="button"
            aria-label={`Move ${item.text} down`}
            className={iconButton}
            disabled={index === items.length - 1}
            onClick={() =>
              void run({
                type: 'moveItem',
                ...base,
                beforeItemId: items[index + 2]?.id ?? null,
              }).catch(() => undefined)
            }
          >
            <ArrowDownIcon aria-hidden="true" className="size-4" />
          </button>
          <button
            type="button"
            aria-label={`Remove ${item.text}`}
            className={`${iconButton} hover:text-danger`}
            onClick={() =>
              void run({ type: 'deleteItem', ...base }).catch(() => undefined)
            }
          >
            <TrashIcon aria-hidden="true" className="size-4" />
          </button>
        </div>
      )}
    </li>
  );
}

function ChecklistBlock({
  checklist,
  index,
  count,
  previousId,
  afterNextId,
  readOnly,
  run,
}: {
  checklist: Checklist;
  index: number;
  count: number;
  previousId?: string;
  afterNextId: string | null;
  readOnly: boolean;
  run: (action: ChecklistAction) => Promise<unknown>;
}) {
  const [mode, setMode] = useState<'view' | 'rename' | 'delete' | 'add'>(
    'view',
  );
  const checklistId = checklist.id;
  const controls: ReactNode = !readOnly && mode !== 'rename' && (
    <div className="flex shrink-0">
      <button
        type="button"
        aria-label={`Rename ${checklist.title}`}
        className={iconButton}
        onClick={() => setMode('rename')}
      >
        <PencilIcon aria-hidden="true" className="size-4" />
      </button>
      {count > 1 && (
        <>
          <button
            type="button"
            aria-label={`Move ${checklist.title} up`}
            className={iconButton}
            disabled={index === 0}
            onClick={() =>
              previousId &&
              void run({
                type: 'move',
                checklistId,
                beforeChecklistId: previousId,
              }).catch(() => undefined)
            }
          >
            <ArrowUpIcon aria-hidden="true" className="size-4" />
          </button>
          <button
            type="button"
            aria-label={`Move ${checklist.title} down`}
            className={iconButton}
            disabled={index === count - 1}
            onClick={() =>
              void run({
                type: 'move',
                checklistId,
                beforeChecklistId: afterNextId,
              }).catch(() => undefined)
            }
          >
            <ArrowDownIcon aria-hidden="true" className="size-4" />
          </button>
        </>
      )}
      <button
        type="button"
        aria-label={`Delete ${checklist.title}`}
        className={`${iconButton} hover:text-danger`}
        onClick={() =>
          checklist.totalItems === 0
            ? void run({ type: 'delete', checklistId }).catch(() => undefined)
            : setMode('delete')
        }
      >
        <TrashIcon aria-hidden="true" className="size-4" />
      </button>
    </div>
  );

  return (
    <li className="space-y-2.5 rounded-xl border border-line p-3 sm:p-4">
      {mode === 'rename' && !readOnly ? (
        <InlineTextForm
          label="Checklist title"
          initial={checklist.title}
          max={CHECKLIST_TITLE_MAX_LENGTH}
          what="a checklist title"
          submitLabel="Save"
          onSubmit={(title) => run({ type: 'rename', checklistId, title })}
          onCancel={() => setMode('view')}
        />
      ) : (
        <div className="flex items-center gap-2">
          <h4 className="min-w-0 flex-1 text-sm font-semibold break-words text-ink">
            {checklist.title}
          </h4>
          <span className="text-xs text-muted tabular-nums">
            {checklist.checkedItems}/{checklist.totalItems}
          </span>
          {controls}
        </div>
      )}
      {mode === 'delete' && !readOnly && (
        <div
          role="group"
          aria-label={`Delete ${checklist.title}`}
          className="space-y-2 rounded-lg border border-danger/30 bg-danger/5 p-3"
        >
          <p className="text-sm text-ink">
            Delete “{checklist.title}” and its {checklist.totalItems}{' '}
            {checklist.totalItems === 1 ? 'item' : 'items'}? This can’t be
            undone.
          </p>
          <div className="flex gap-2">
            <Button
              variant="danger"
              size="sm"
              onClick={() =>
                void run({ type: 'delete', checklistId }).catch(() =>
                  setMode('view'),
                )
              }
            >
              Delete checklist
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setMode('view')}
            >
              Keep checklist
            </Button>
          </div>
        </div>
      )}
      <ProgressBar checklist={checklist} />
      {checklist.items.length === 0 ? (
        <p className="text-sm text-muted">This checklist has no items yet.</p>
      ) : (
        <ul aria-label={`${checklist.title} items`}>
          {checklist.items.map((item, itemIndex) => (
            <ItemRow
              key={item.id}
              item={item}
              index={itemIndex}
              items={checklist.items}
              readOnly={readOnly}
              run={run}
            />
          ))}
        </ul>
      )}
      {!readOnly &&
        (mode === 'add' ? (
          <InlineTextForm
            label={`New item in ${checklist.title}`}
            max={CHECKLIST_ITEM_MAX_LENGTH}
            what="the item text"
            submitLabel="Add"
            keepOpen
            onSubmit={(text) => run({ type: 'addItem', checklistId, text })}
            onCancel={() => setMode('view')}
          />
        ) : (
          <button
            type="button"
            className={sectionActionClass}
            onClick={() => setMode('add')}
          >
            <PlusIcon aria-hidden="true" className="size-4" />
            Add item
            <span className="sr-only"> to {checklist.title}</span>
          </button>
        ))}
    </li>
  );
}

/** P3-09 checklists block of Card Detail V2. Every change is persisted. */
export function CardChecklists({
  boardId,
  cardId,
  readOnly,
}: CardChecklistsProps) {
  const query = useChecklists(boardId, cardId);
  const action = useChecklistAction(boardId, cardId);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string>();
  const data = query.data;

  const run = async (next: ChecklistAction) => {
    setError(undefined);
    try {
      return await action.run(next);
    } catch (failure) {
      setError(checklistErrorMessage(failure));
      throw failure;
    }
  };

  const denied =
    isApiError(query.error) && [403, 404].includes(query.error.status);
  const total = data?.totalItems ?? 0;

  return (
    <CardDetailSection
      icon={<CheckSquareIcon />}
      title="Checklists"
      meta={
        <>
          {data && total > 0 && (
            <span className="text-xs text-muted">
              {data.checkedItems} of {total} completed
            </span>
          )}
          {(action.isPending || (query.isFetching && !query.isPending)) && (
            <span role="status" className="flex items-center text-muted">
              <SpinnerIcon
                aria-hidden="true"
                className="size-4 motion-safe:animate-spin"
              />
              <span className="sr-only">
                {action.isPending ? 'Saving checklist…' : 'Refreshing…'}
              </span>
            </span>
          )}
        </>
      }
      action={
        !readOnly &&
        data &&
        !adding && (
          <button
            type="button"
            className={sectionActionClass}
            onClick={() => setAdding(true)}
          >
            <PlusIcon aria-hidden="true" className="size-4" />
            Add checklist
          </button>
        )
      }
    >
      <div className="space-y-3">
        {error && <Alert variant="error">{error}</Alert>}
        {query.isPending ? (
          <p role="status" className="text-sm text-muted">
            Loading checklists…
          </p>
        ) : query.isError && !data ? (
          <Alert variant="error">
            {denied
              ? 'You no longer have access to this card’s checklists.'
              : 'We couldn’t load the checklists.'}{' '}
            {!denied && (
              <button
                type="button"
                className="font-medium underline"
                onClick={() => void query.refetch()}
              >
                Try again
              </button>
            )}
          </Alert>
        ) : (
          data && (
            <>
              {adding && !readOnly && (
                <InlineTextForm
                  label="Checklist title"
                  max={CHECKLIST_TITLE_MAX_LENGTH}
                  what="a checklist title"
                  submitLabel="Add checklist"
                  onSubmit={(title) => run({ type: 'create', title })}
                  onCancel={() => setAdding(false)}
                />
              )}
              {data.checklists.length === 0 && !adding ? (
                <p className="text-sm text-muted">
                  {readOnly
                    ? 'No checklists.'
                    : 'No checklists yet. Add one to track steps.'}
                </p>
              ) : (
                <ul className="space-y-3">
                  {data.checklists.map((checklist, index, rows) => (
                    <ChecklistBlock
                      key={checklist.id}
                      checklist={checklist}
                      index={index}
                      count={rows.length}
                      previousId={rows[index - 1]?.id}
                      afterNextId={rows[index + 2]?.id ?? null}
                      readOnly={readOnly}
                      run={run}
                    />
                  ))}
                </ul>
              )}
            </>
          )
        )}
      </div>
    </CardDetailSection>
  );
}
