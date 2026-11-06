import { useEffect, type RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CalendarIcon,
  CheckSquareIcon,
  CloseIcon,
  ExternalLinkIcon,
  TextIcon,
  UsersIcon,
} from '../../../components/icons';
import { isApiError } from '../../../lib/api-client';
import { UserAvatar } from '../../auth/components/UserAvatar';
import type { BoardMember } from '../../board-members/types';
import { formatCardInstant } from '../../cards/card-dates';
import { useChecklists } from '../../cards/checklists/hooks';
import { DueStatusBadge } from '../../cards/components/detail/CardDates';
import type { Card } from '../../cards/types';
import type { Label } from '../../labels/api';
import { LabelBadges } from '../../labels/components/LabelBadge';
import { boardKeys } from '../query-keys';
import { ChecklistProgress } from './ChecklistProgress';

export function CalendarCardInspector({
  card,
  boardName,
  columnName,
  labels,
  members,
  timeZone,
  dateFormat,
  now,
  closeButton,
  onClose,
  onOpen,
}: {
  card: Card;
  boardName: string;
  columnName?: string;
  labels: Label[];
  members: BoardMember[];
  timeZone: string;
  dateFormat: Parameters<typeof formatCardInstant>[1];
  now: number;
  closeButton: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onOpen: () => void;
}) {
  const checklists = useChecklists(card.boardId, card.id);
  const client = useQueryClient();
  const denied =
    isApiError(checklists.error) &&
    [403, 404].includes(checklists.error.status);
  useEffect(() => {
    if (denied)
      void client.invalidateQueries({
        queryKey: boardKeys.detail(card.boardId),
        exact: true,
      });
  }, [card.boardId, client, denied]);
  if (denied)
    return (
      <aside aria-label="Selected card" className="calendar-inspector">
        Checking card access…
      </aside>
    );
  return (
    <aside aria-label="Selected card" className="calendar-inspector">
      <div className="flex items-start gap-1">
        <h2 className="min-w-0 flex-1 pt-1 text-lg leading-snug font-semibold break-words">
          {card.title}
        </h2>
        <button
          type="button"
          aria-label="Open card"
          title="Open card"
          className="grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-app hover:text-ink"
          onClick={onOpen}
        >
          <ExternalLinkIcon className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Close inspector"
          title="Close inspector"
          ref={closeButton}
          className="grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-app hover:text-ink"
          onClick={onClose}
        >
          <CloseIcon className="size-4" />
        </button>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        {columnName ?? 'Unavailable'} in {boardName} · Created{' '}
        <time dateTime={card.createdAt}>
          {formatCardInstant(card.createdAt, dateFormat, timeZone)}
        </time>{' '}
        · Updated{' '}
        <time dateTime={card.updatedAt}>
          {formatCardInstant(card.updatedAt, dateFormat, timeZone)}
        </time>
      </p>
      <div className="calendar-inspector-labels mt-2">
        <LabelBadges labels={labels} />
      </div>
      <section className="calendar-inspector-section">
        <h3>
          <TextIcon />
          Description
        </h3>
        <p className="calendar-inspector-content whitespace-pre-wrap break-words">
          {card.description || (
            <span className="text-muted">No description</span>
          )}
        </p>
      </section>
      <section className="calendar-inspector-section">
        <h3>
          <UsersIcon />
          Assignees
        </h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {card.assignees.length ? (
            card.assignees.map((assignee) => {
              const user = members.find(
                (member) => member.user.id === assignee.userId,
              )?.user;
              return (
                <span key={assignee.userId} className="calendar-assignee">
                  {user && (
                    <UserAvatar
                      user={user}
                      className="size-7 shrink-0 text-xs"
                    />
                  )}
                  <span className="min-w-0 break-words">
                    {user?.displayName ?? 'Unavailable'}
                  </span>
                </span>
              );
            })
          ) : (
            <span className="calendar-inspector-content text-muted">None</span>
          )}
        </div>
      </section>
      <section className="calendar-inspector-section">
        <h3>
          <CalendarIcon />
          Dates
        </h3>
        <dl className="calendar-inspector-content grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
          <dt className="text-muted">Start</dt>
          <dd>
            {card.startDate ? (
              <time dateTime={card.startDate}>
                {formatCardInstant(card.startDate, dateFormat, timeZone)}
              </time>
            ) : (
              'None'
            )}
          </dd>
          <dt className="text-muted">Due</dt>
          <dd>
            {card.dueDate ? (
              <time dateTime={card.dueDate}>
                {formatCardInstant(card.dueDate, dateFormat, timeZone)}
              </time>
            ) : (
              'None'
            )}
            <div className="mt-1">
              <DueStatusBadge
                dueDate={card.dueDate}
                timeZone={timeZone}
                now={now}
              />
            </div>
          </dd>
        </dl>
      </section>
      <section className="calendar-inspector-section">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3>
            <CheckSquareIcon />
            Checklists
          </h3>
          {checklists.data && (
            <span className="text-xs text-muted">
              {checklists.data.checkedItems} of {checklists.data.totalItems}{' '}
              completed
            </span>
          )}
        </div>
        {checklists.isPending ? (
          <p className="mt-2 text-muted">Loading checklists…</p>
        ) : checklists.isError ? (
          <p role="alert" className="mt-2 text-muted">
            Could not load checklists.{' '}
            <button
              type="button"
              className="text-primary underline"
              onClick={() => void checklists.refetch()}
            >
              Retry
            </button>
          </p>
        ) : checklists.data.checklists.length ? (
          checklists.data.checklists.map((checklist) => (
            <div
              key={checklist.id}
              className="mt-2 rounded-lg border border-line bg-app/30 p-3"
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <h4 className="min-w-0 font-medium break-words">
                  {checklist.title}
                </h4>
                <span className="shrink-0 text-xs text-muted">
                  {checklist.checkedItems}/{checklist.totalItems}
                </span>
              </div>
              <ChecklistProgress
                checked={checklist.checkedItems}
                total={checklist.totalItems}
                label={`Checklist ${checklist.title}`}
              />
              <ul className="mt-3 space-y-2">
                {checklist.items.map((item) => (
                  <li key={item.id} className="flex items-start gap-2">
                    {item.isChecked ? (
                      <CheckSquareIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0 rounded border border-muted"
                      />
                    )}
                    <span
                      className={`min-w-0 break-words ${item.isChecked ? 'text-muted line-through' : ''}`}
                    >
                      <span className="sr-only">
                        {item.isChecked ? 'Completed: ' : 'Incomplete: '}
                      </span>
                      {item.text}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        ) : (
          <p className="calendar-inspector-content text-muted">No checklists</p>
        )}
      </section>
    </aside>
  );
}
