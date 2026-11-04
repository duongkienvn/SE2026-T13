import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { UserAvatar } from '../auth/components/UserAvatar';
import type { MemberUser } from '../board-members/types';
import {
  activeMention,
  capError,
  insertMention,
  rebaseSpans,
  suggest,
  type MentionQuery,
} from './mentions';
import type { CommentMention } from './types';
import './mentions.css';

export interface MentionDraft {
  text: string;
  spans: CommentMention[];
}

export const emptyDraft: MentionDraft = { text: '', spans: [] };

interface MentionComposerProps {
  label: string;
  value: MentionDraft;
  onChange: (next: MentionDraft) => void;
  /** Authorized Board roster; empty or `enabled=false` means plain comments. */
  members: MemberUser[];
  /** False when the viewer cannot read the Board member directory. */
  enabled: boolean;
  currentUserId?: string;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  error?: string;
  /** Classes for the wrapper; mirrors TextAreaField so layouts stay as they were. */
  className?: string;
  /** Extra classes for the textarea itself. */
  textareaClassName?: string;
  hideLabel?: boolean;
}

/**
 * Textarea with accessible @mention suggestions. Only a selected suggestion
 * becomes a mention span; typed `@Name` text stays ordinary text.
 */
export function MentionComposer({
  label,
  value,
  onChange,
  members,
  enabled,
  currentUserId,
  placeholder,
  rows = 3,
  maxLength,
  error,
  className = '',
  textareaClassName = '',
  hideLabel = false,
}: MentionComposerProps) {
  const id = useId();
  const listId = `${id}-mentions`;
  const errorId = error ? `${id}-error` : undefined;
  const statusId = `${id}-status`;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | undefined>(undefined);
  const composing = useRef(false);
  const [active, setActive] = useState<MentionQuery>();
  const [dismissedAt, setDismissedAt] = useState<number>();
  const [highlight, setHighlight] = useState(0);
  const [navigated, setNavigated] = useState(false);
  const [capMessage, setCapMessage] = useState<string>();

  const candidates = enabled
    ? members
        .filter((member) => member.id !== currentUserId)
        .map((member) => ({
          userId: member.id,
          displayName: member.displayName,
        }))
    : [];
  const byId = new Map(members.map((member) => [member.id, member]));
  const open =
    enabled &&
    !!active &&
    active.start !== dismissedAt &&
    candidates.length > 0;
  const options = open ? suggest(candidates, active.query) : [];
  const showList = open && options.length > 0;
  const duplicateNames = new Set(
    candidates
      .map((candidate) => candidate.displayName.toLocaleLowerCase())
      .filter((name, index, all) => all.indexOf(name) !== index),
  );

  useLayoutEffect(() => {
    if (pendingCaret.current === undefined || !textarea.current) return;
    const caret = pendingCaret.current;
    pendingCaret.current = undefined;
    textarea.current.focus();
    textarea.current.setSelectionRange(caret, caret);
  });

  const track = (text: string, spans: CommentMention[], caret: number) => {
    const next = activeMention(text, caret, spans);
    if (next?.start !== active?.start || next?.query !== active?.query) {
      setHighlight(0);
      setNavigated(false);
    }
    setActive(next);
    if (next?.start !== dismissedAt) setDismissedAt(undefined);
  };

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const text = event.target.value;
    const caret = event.target.selectionEnd ?? text.length;
    const spans = rebaseSpans(value.spans, value.text, text, caret);
    setCapMessage(undefined);
    onChange({ text, spans });
    track(text, spans, caret);
  };

  const recheck = () => {
    const element = textarea.current;
    if (!element) return;
    if (element.selectionStart !== element.selectionEnd) {
      setActive(undefined);
      return;
    }
    track(element.value, value.spans, element.selectionStart);
  };

  const choose = (index: number) => {
    const element = textarea.current;
    const candidate = options[index];
    if (!element || !active || !candidate) return;
    const result = insertMention(
      value.text,
      value.spans,
      active,
      element.selectionStart,
      candidate,
    );
    const cap = capError(result.spans);
    if (cap) {
      setCapMessage(cap);
      setDismissedAt(active.start);
      return;
    }
    if (maxLength !== undefined && result.text.length > maxLength) {
      setCapMessage('There is no room left for this mention.');
      setDismissedAt(active.start);
      return;
    }
    pendingCaret.current = result.caret;
    onChange({ text: result.text, spans: result.spans });
    setActive(undefined);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showList) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setNavigated(true);
      setHighlight(
        (current) =>
          (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) %
          options.length,
      );
    } else if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !composing.current &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      choose(highlight);
    } else if (event.key === 'Tab' && navigated && !event.shiftKey) {
      event.preventDefault();
      choose(highlight);
    } else if (event.key === 'Escape') {
      // Close only the suggestions, never the Card Detail dialog around us.
      event.preventDefault();
      event.stopPropagation();
      setDismissedAt(active?.start);
    }
  };

  const activeOption = showList ? `${listId}-${highlight}` : undefined;

  return (
    <div className={`mention-composer ${className}`}>
      <label
        htmlFor={id}
        className={hideLabel ? 'sr-only' : 'block text-sm font-medium text-ink'}
      >
        {label}
      </label>
      <textarea
        ref={textarea}
        id={id}
        rows={rows}
        value={value.text}
        placeholder={placeholder}
        maxLength={maxLength}
        role={enabled ? 'combobox' : undefined}
        aria-autocomplete={enabled ? 'list' : undefined}
        aria-expanded={enabled ? showList : undefined}
        aria-controls={showList ? listId : undefined}
        aria-activedescendant={activeOption}
        aria-invalid={error ? true : undefined}
        aria-describedby={[errorId, statusId].filter(Boolean).join(' ')}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onKeyUp={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
            recheck();
        }}
        onClick={recheck}
        onBlur={() => setActive(undefined)}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        className={`${hideLabel ? '' : 'mt-1.5'} block w-full resize-y rounded-lg border bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-muted/80 focus:ring-3 focus:ring-primary/15 focus:outline-none disabled:resize-none disabled:bg-app disabled:text-muted ${
          error
            ? 'border-danger focus:border-danger'
            : 'border-line focus:border-primary'
        } ${textareaClassName}`}
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Mention a board member"
          className="mention-list"
        >
          {options.map((option, index) => {
            const member = byId.get(option.userId);
            const duplicate = duplicateNames.has(
              option.displayName.toLocaleLowerCase(),
            );
            return (
              <li
                key={option.userId}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === highlight}
                className="mention-option"
                // Keep focus in the textarea so the caret survives selection.
                onMouseDown={(event) => event.preventDefault()}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(index)}
                onMouseEnter={() => setHighlight(index)}
              >
                {member && (
                  <UserAvatar user={member} className="size-7 text-[11px]" />
                )}
                <span className="min-w-0">
                  <span className="mention-option-name">
                    {option.displayName}
                  </span>
                  {duplicate && member?.email && (
                    <span className="mention-option-detail">
                      {member.email}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p id={statusId} role="status" className="sr-only">
        {showList
          ? `${options.length} ${options.length === 1 ? 'member' : 'members'} found. Use up and down arrows, Enter to mention.`
          : ''}
      </p>
      {capMessage && (
        <p role="alert" className="mt-1 text-[13px] text-danger">
          {capMessage}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
