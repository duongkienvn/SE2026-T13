import type { CommentMention } from './types';

/**
 * Comment @mention spans (#199, P4-04 contract): `start` inclusive, `end`
 * exclusive, zero-based JavaScript UTF-16 code units, covering `@` plus the
 * member's display name in the exact content that is sent.
 */

export const MAX_MENTION_SPANS = 20;
export const MAX_MENTIONED_USERS = 10;
export const MAX_SUGGESTIONS = 8;

export interface MentionCandidate {
  userId: string;
  displayName: string;
}

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** True when `index` would split a surrogate pair. */
export function splitsPair(text: string, index: number) {
  return (
    index > 0 &&
    index < text.length &&
    isHigh(text.charCodeAt(index - 1)) &&
    isLow(text.charCodeAt(index))
  );
}

export const mentionText = (name: string) => `@${name}`;

/**
 * Rebase spans after the textarea value changed from `before` to `after`.
 * `caret` is the caret after the edit: the changed region ends there, which
 * resolves repeated characters (typing "n" after "@Ann"). A span touched by
 * the change is dropped (its text stays as ordinary text); spans after it
 * shift. Handles typing, paste, cut, selection replacement and undo/redo.
 */
export function rebaseSpans(
  spans: CommentMention[],
  before: string,
  after: string,
  caret: number,
): CommentMention[] {
  if (before === after) return spans;
  const delta = after.length - before.length;
  let suffix = 0;
  const maxSuffix = Math.min(before.length, after.length, after.length - caret);
  while (
    suffix < maxSuffix &&
    before.charCodeAt(before.length - 1 - suffix) ===
      after.charCodeAt(after.length - 1 - suffix)
  )
    suffix++;
  let prefix = 0;
  const maxPrefix = Math.min(before.length - suffix, after.length - suffix);
  while (
    prefix < maxPrefix &&
    before.charCodeAt(prefix) === after.charCodeAt(prefix)
  )
    prefix++;
  const oldEnd = before.length - suffix;
  const result: CommentMention[] = [];
  for (const span of spans) {
    // Typing right after a mention (prefix === end) keeps it.
    if (span.end <= prefix) result.push(span);
    else if (span.start >= oldEnd)
      result.push({
        ...span,
        start: span.start + delta,
        end: span.end + delta,
      });
    // Otherwise the edit touched the mention: keep the text, drop the link.
  }
  return result.filter(
    (span) =>
      span.start >= 0 && span.end <= after.length && after[span.start] === '@',
  );
}

/** Keep only spans that still read exactly `@` + the member's current name. */
export function keepValidSpans(
  spans: CommentMention[],
  text: string,
  names: Map<string, string>,
) {
  return spans.filter((span) => {
    const name = names.get(span.userId);
    return (
      name !== undefined &&
      text.slice(span.start, span.end) === mentionText(name)
    );
  });
}

const BOUNDARY = /[\s([{"'“‘«,;:!?/]/u;

export interface MentionQuery {
  /** Index of the `@`. */
  start: number;
  /** Text typed after the `@`, up to the caret. */
  query: string;
}

/**
 * The active `@query` at a collapsed caret, if any. The `@` must follow the
 * start of the text, whitespace or punctuation (so `ada@example.com` never
 * triggers), must not be inside an existing mention, and the query has no
 * line break or leading space.
 */
export function activeMention(
  text: string,
  caret: number,
  spans: CommentMention[],
): MentionQuery | undefined {
  const from = Math.max(0, caret - 64);
  for (let index = caret - 1; index >= from; index--) {
    const char = text[index];
    if (char === '\n') return undefined;
    if (char !== '@') continue;
    if (index > 0 && !BOUNDARY.test(text[index - 1])) return undefined;
    if (spans.some((span) => index >= span.start && index < span.end))
      return undefined;
    const query = text.slice(index + 1, caret);
    if (/^\s/u.test(query) || /\s{2}/u.test(query)) return undefined;
    return { start: index, query };
  }
  return undefined;
}

/** Case- and accent-insensitive key: "Đặng Linh" matches "dang li". */
export function searchKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLocaleLowerCase();
}

/** Up to eight members: name prefix matches first, then word-start matches. */
export function suggest(
  candidates: MentionCandidate[],
  query: string,
  limit = MAX_SUGGESTIONS,
) {
  const key = searchKey(query);
  const ranked: { candidate: MentionCandidate; rank: number }[] = [];
  for (const candidate of candidates) {
    const name = searchKey(candidate.displayName);
    const rank = name.startsWith(key)
      ? 0
      : name.split(/\s+/u).some((word) => word.startsWith(key))
        ? 1
        : name.includes(key) && key.length > 1
          ? 2
          : -1;
    if (rank >= 0) ranked.push({ candidate, rank });
  }
  return ranked
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.candidate.displayName.localeCompare(b.candidate.displayName) ||
        a.candidate.userId.localeCompare(b.candidate.userId),
    )
    .slice(0, limit)
    .map((item) => item.candidate);
}

export interface InsertResult {
  text: string;
  spans: CommentMention[];
  caret: number;
}

/**
 * Replace the active `@query` with `@Name` (plus a separating space when the
 * next character is not already whitespace) and record its span.
 */
export function insertMention(
  text: string,
  spans: CommentMention[],
  active: MentionQuery,
  caret: number,
  candidate: MentionCandidate,
): InsertResult {
  const label = mentionText(candidate.displayName);
  const next = text[caret];
  const spacer = next === undefined || !/\s/u.test(next) ? ' ' : '';
  const inserted = label + spacer;
  const after = text.slice(0, active.start) + inserted + text.slice(caret);
  const delta = inserted.length - (caret - active.start);
  const moved = spans
    .filter((span) => span.end <= active.start || span.start >= caret)
    .map((span) =>
      span.start >= caret
        ? { ...span, start: span.start + delta, end: span.end + delta }
        : span,
    );
  const span = {
    userId: candidate.userId,
    start: active.start,
    end: active.start + label.length,
  };
  return {
    text: after,
    spans: [...moved, span].sort((a, b) => a.start - b.start),
    caret: active.start + inserted.length,
  };
}

export function capError(spans: CommentMention[]) {
  if (spans.length > MAX_MENTION_SPANS)
    return `A comment can have at most ${MAX_MENTION_SPANS} mentions.`;
  if (new Set(spans.map((span) => span.userId)).size > MAX_MENTIONED_USERS)
    return `A comment can mention at most ${MAX_MENTIONED_USERS} people.`;
  return undefined;
}

/**
 * Exactly what is sent: trimmed content and spans rebased onto it. Spans are
 * computed after trimming, never trimmed afterwards.
 */
export function finalizeMentions(text: string, spans: CommentMention[]) {
  const content = text.trim();
  const leading = text.length - text.trimStart().length;
  const mentions = spans
    .map((span) => ({
      userId: span.userId,
      start: span.start - leading,
      end: span.end - leading,
    }))
    .filter((span) => span.start >= 0 && span.end <= content.length)
    .sort((a, b) => a.start - b.start);
  return { content, mentions };
}

/**
 * Server spans are untrusted at render time. Any malformed, overlapping,
 * out-of-range or pair-splitting span, or one not starting with `@`, makes
 * the whole comment render as plain text.
 */
export function validRenderSpans(
  content: string,
  mentions: unknown,
): CommentMention[] | undefined {
  if (!Array.isArray(mentions) || mentions.length === 0) return undefined;
  if (mentions.length > MAX_MENTION_SPANS) return undefined;
  const spans = [...mentions] as CommentMention[];
  for (const span of spans)
    if (
      !span ||
      typeof span.userId !== 'string' ||
      !Number.isSafeInteger(span.start) ||
      !Number.isSafeInteger(span.end) ||
      span.start < 0 ||
      span.end > content.length ||
      span.end - span.start < 2 ||
      content[span.start] !== '@' ||
      splitsPair(content, span.start) ||
      splitsPair(content, span.end)
    )
      return undefined;
  spans.sort((a, b) => a.start - b.start);
  for (let index = 1; index < spans.length; index++)
    if (spans[index].start < spans[index - 1].end) return undefined;
  return spans;
}

/** Plain-text and mention chunks that join back to exactly `content`. */
export function splitContent(content: string, spans: CommentMention[]) {
  const parts: { text: string; mention?: CommentMention }[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor)
      parts.push({ text: content.slice(cursor, span.start) });
    parts.push({ text: content.slice(span.start, span.end), mention: span });
    cursor = span.end;
  }
  if (cursor < content.length) parts.push({ text: content.slice(cursor) });
  return parts;
}

export const sameSpans = (a: CommentMention[], b: CommentMention[]) =>
  a.length === b.length &&
  a.every(
    (span, index) =>
      span.userId === b[index].userId &&
      span.start === b[index].start &&
      span.end === b[index].end,
  );
