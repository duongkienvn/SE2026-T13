import { useId, useRef, useState, type FormEvent } from 'react';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { TextField } from '../../../components/TextField';
import {
  PencilIcon,
  PlusIcon,
  TagIcon,
  TrashIcon,
} from '../../../components/icons';
import { useReportDirty } from '../../cards/card-draft';
import {
  CardRailGroup,
  sectionActionClass,
} from '../../cards/components/detail/CardDetailSection';
import { LABEL_NAME_MAX_LENGTH, MAX_BOARD_LABELS, type Label } from '../api';
import {
  labelErrorMessage,
  useCardLabels,
  useCreateLabel,
  useDeleteLabel,
  useLabelCatalog,
  useToggleCardLabel,
  useUpdateLabel,
} from '../hooks';
import { LabelBadge, LabelBadges, LABEL_COLORS } from './LabelBadge';

const iconButton =
  'grid size-9 shrink-0 place-items-center rounded-md text-muted hover:bg-app hover:text-ink focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40';

/** Name + color form for creating or editing a catalog label. */
function LabelForm({
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  initial?: Pick<Label, 'name' | 'color'>;
  submitLabel: string;
  pending: boolean;
  onSubmit: (input: { name: string; color: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState<string>(
    initial?.color ?? LABEL_COLORS[0].value,
  );
  const [error, setError] = useState<string>();
  const groupId = useId();
  useReportDirty(
    name.trim() !== (initial?.name ?? '').trim() ||
      (!!initial && color !== initial.color),
  );
  const colors = LABEL_COLORS.some((option) => option.value === color)
    ? LABEL_COLORS
    : [{ value: color, name: 'Current color' }, ...LABEL_COLORS];

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError('Enter a label name.');
    if (trimmed.length > LABEL_NAME_MAX_LENGTH)
      return setError(`Use at most ${LABEL_NAME_MAX_LENGTH} characters.`);
    setError(undefined);
    try {
      await onSubmit({ name: trimmed, color });
    } catch (failure) {
      setError(labelErrorMessage(failure));
    }
  };

  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      className="space-y-3 rounded-lg border border-line p-3"
    >
      <TextField
        label="Label name"
        autoFocus
        value={name}
        error={error}
        onChange={(event) => setName(event.currentTarget.value)}
      />
      <fieldset>
        <legend id={groupId} className="text-sm font-medium text-ink">
          Color
        </legend>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {colors.map((option) => (
            <label
              key={option.value}
              title={option.name}
              className="relative grid size-8 cursor-pointer place-items-center rounded-md has-checked:ring-2 has-checked:ring-ink has-checked:ring-offset-2 has-checked:ring-offset-surface has-focus-visible:outline-2 has-focus-visible:outline-primary"
              style={{ backgroundColor: option.value }}
            >
              <input
                type="radio"
                name={groupId}
                className="sr-only"
                value={option.value}
                checked={color === option.value}
                onChange={() => setColor(option.value)}
              />
              <span className="sr-only">{option.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="text-[13px] text-muted">
        Preview: <LabelBadge label={{ name: name.trim() || 'Label', color }} />
      </p>
      <div className="flex flex-wrap gap-2">
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

function LabelPicker({
  boardId,
  cardId,
  assigned,
  canAssign,
  onDone,
}: {
  boardId: string;
  cardId: string;
  assigned: Label[];
  canAssign: boolean;
  onDone: () => void;
}) {
  const catalog = useLabelCatalog(boardId);
  const toggle = useToggleCardLabel(boardId, cardId);
  const create = useCreateLabel(boardId);
  const update = useUpdateLabel(boardId);
  const remove = useDeleteLabel(boardId);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<
    | { type: 'list' }
    | { type: 'create' }
    | { type: 'edit'; label: Label }
    | { type: 'delete'; label: Label }
  >({ type: 'list' });
  const [error, setError] = useState<string>();
  const assignedIds = new Set(assigned.map((label) => label.id));
  const labels = catalog.data ?? [];
  const query = search.trim().toLowerCase();
  const shown = query
    ? labels.filter((label) => label.name.toLowerCase().includes(query))
    : labels;

  const content = () => {
    if (mode.type === 'create')
      return (
        <LabelForm
          submitLabel="Create label"
          pending={create.isPending}
          onCancel={() => setMode({ type: 'list' })}
          onSubmit={async (input) => {
            const label = await create.mutateAsync(input);
            setMode({ type: 'list' });
            // A label made from a card is meant for that card.
            if (canAssign)
              toggle.mutate(
                { labelId: label.id, assign: true },
                { onError: (failure) => setError(labelErrorMessage(failure)) },
              );
          }}
        />
      );
    if (mode.type === 'edit')
      return (
        <LabelForm
          initial={mode.label}
          submitLabel="Save label"
          pending={update.isPending}
          onCancel={() => setMode({ type: 'list' })}
          onSubmit={async (input) => {
            await update.mutateAsync({ labelId: mode.label.id, ...input });
            setMode({ type: 'list' });
          }}
        />
      );
    if (mode.type === 'delete')
      return (
        <div
          role="group"
          aria-label={`Delete ${mode.label.name}`}
          className="space-y-3 rounded-lg border border-danger/30 bg-danger/5 p-3"
        >
          <p className="text-sm text-ink">
            Delete “{mode.label.name}” from this board? It is removed from every
            card that uses it. To take it off this card only, untick it instead.
          </p>
          {error && <Alert variant="error">{error}</Alert>}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              size="sm"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(mode.label.id, {
                  onSuccess: () => setMode({ type: 'list' }),
                  onError: (failure) => setError(labelErrorMessage(failure)),
                })
              }
            >
              {remove.isPending ? 'Deleting…' : 'Delete label'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              autoFocus
              disabled={remove.isPending}
              onClick={() => {
                setError(undefined);
                setMode({ type: 'list' });
              }}
            >
              Keep label
            </Button>
          </div>
        </div>
      );

    return (
      <div className="space-y-3 rounded-lg border border-line p-3">
        <TextField
          label="Search labels"
          type="search"
          autoFocus
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
        {error && <Alert variant="error">{error}</Alert>}
        {catalog.isPending ? (
          <p role="status" className="text-sm text-muted">
            Loading labels…
          </p>
        ) : catalog.isError ? (
          <Alert variant="error">
            We couldn’t load this board’s labels.{' '}
            <button
              type="button"
              className="font-medium underline"
              onClick={() => void catalog.refetch()}
            >
              Try again
            </button>
          </Alert>
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted">
            {labels.length === 0
              ? 'This board has no labels yet.'
              : 'No labels match your search.'}
          </p>
        ) : (
          <ul aria-label="Board labels" className="space-y-1">
            {shown.map((label) => (
              <li key={label.id} className="flex items-center gap-1">
                <label className="flex min-h-10 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md px-1 hover:bg-app has-disabled:cursor-default">
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-[var(--color-primary-solid)]"
                    checked={assignedIds.has(label.id)}
                    disabled={!canAssign || toggle.isPending}
                    onChange={(event) => {
                      setError(undefined);
                      toggle.mutate(
                        {
                          labelId: label.id,
                          assign: event.currentTarget.checked,
                        },
                        {
                          onError: (failure) =>
                            setError(labelErrorMessage(failure)),
                        },
                      );
                    }}
                  />
                  <LabelBadge label={label} />
                </label>
                <button
                  type="button"
                  aria-label={`Edit label ${label.name}`}
                  className={iconButton}
                  onClick={() => setMode({ type: 'edit', label })}
                >
                  <PencilIcon aria-hidden="true" className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Delete label ${label.name}`}
                  className={`${iconButton} hover:text-danger`}
                  onClick={() => setMode({ type: 'delete', label })}
                >
                  <TrashIcon aria-hidden="true" className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {labels.length < MAX_BOARD_LABELS ? (
            <button
              type="button"
              className={sectionActionClass}
              onClick={() => {
                setError(undefined);
                setMode({ type: 'create' });
              }}
            >
              <PlusIcon aria-hidden="true" className="size-4" />
              Create label
            </button>
          ) : (
            <p className="text-[13px] text-muted">
              This board has the maximum of {MAX_BOARD_LABELS} labels.
            </p>
          )}
          <Button
            variant="secondary"
            size="sm"
            className="ml-auto"
            onClick={onDone}
          >
            Done
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div
      onKeyDown={(event) => {
        if (
          event.key !== 'Escape' ||
          event.nativeEvent.isComposing ||
          event.keyCode === 229
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        if (
          create.isPending ||
          update.isPending ||
          remove.isPending ||
          toggle.isPending
        )
          return;
        if (mode.type === 'list') onDone();
        else {
          setError(undefined);
          setMode({ type: 'list' });
        }
      }}
    >
      {content()}
    </div>
  );
}

/** Badges for the card header, read-only. */
export function CardLabelBadges({
  boardId,
  cardId,
}: {
  boardId: string;
  cardId: string;
}) {
  const labels = useCardLabels(boardId, cardId);
  return <LabelBadges labels={labels.data?.labels ?? []} />;
}

/**
 * P3-09 labels rail block. Assigning needs an editable card; the catalog
 * belongs to the board, so it stays editable on an archived card of an
 * active board, and every delete is announced as board-wide.
 */
export function CardLabels({
  boardId,
  cardId,
  cardReadOnly,
  boardReadOnly,
}: {
  boardId: string;
  cardId: string;
  cardReadOnly: boolean;
  boardReadOnly: boolean;
}) {
  const labels = useCardLabels(boardId, cardId);
  const [picking, setPicking] = useState(false);
  const pickerButton = useRef<HTMLButtonElement>(null);
  const assigned = labels.data?.labels ?? [];

  return (
    <CardRailGroup title="Labels" icon={<TagIcon />}>
      {labels.isPending ? (
        <p role="status" className="text-sm text-muted">
          Loading labels…
        </p>
      ) : labels.isError && !labels.data ? (
        <p className="text-sm text-muted">Labels are unavailable.</p>
      ) : assigned.length === 0 ? (
        <p className="text-sm text-muted">No labels.</p>
      ) : (
        <LabelBadges labels={assigned} />
      )}
      {!boardReadOnly &&
        (picking ? (
          <LabelPicker
            boardId={boardId}
            cardId={cardId}
            assigned={assigned}
            canAssign={!cardReadOnly}
            onDone={() => {
              setPicking(false);
              requestAnimationFrame(() => pickerButton.current?.focus());
            }}
          />
        ) : (
          <button
            ref={pickerButton}
            type="button"
            className={sectionActionClass}
            onClick={() => setPicking(true)}
          >
            <TagIcon aria-hidden="true" className="size-4" />
            {cardReadOnly ? 'Manage board labels' : 'Edit labels'}
          </button>
        ))}
    </CardRailGroup>
  );
}
