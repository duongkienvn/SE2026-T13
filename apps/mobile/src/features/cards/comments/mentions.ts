import { ApiError } from '../../../infrastructure/api/errors.ts';

export type Mention = { userId: string; start: number; end: number };
export type MentionDraft = { text: string; spans: Mention[] };
export type Candidate = {
  userId: string;
  displayName: string;
  page: number;
  detail?: string;
};
export type Selection = { start: number; end: number };
export const emptyDraft = (): MentionDraft => ({ text: '', spans: [] });
const uuid4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function splitsPair(text: string, at: number) {
  return (
    at > 0 &&
    at < text.length &&
    /[\uD800-\uDBFF]/.test(text[at - 1]) &&
    /[\uDC00-\uDFFF]/.test(text[at])
  );
}

/** Structural validation also protects rendering. No identity is inferred from text. */
export function validSpans(text: string, raw: unknown): raw is Mention[] {
  if (!Array.isArray(raw) || raw.length > 20) return false;
  let end = 0;
  const users = new Set<string>();
  for (const value of raw) {
    if (!value || typeof value !== 'object') return false;
    const { userId, start, end: next } = value;
    if (
      typeof userId !== 'string' ||
      !uuid4.test(userId) ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(next) ||
      start < end ||
      next <= start + 1 ||
      next > text.length ||
      text[start] !== '@' ||
      splitsPair(text, start) ||
      splitsPair(text, next)
    )
      return false;
    end = next;
    users.add(userId.toLowerCase());
  }
  return users.size <= 10;
}

/** RN selection events can arrive after text events. Preserve only spans outside
 * every possible single-replacement region; repeated-text ambiguity drops identity.
 * JS indices/slices deliberately count UTF-16 code units, including surrogate pairs.
 */
export function changeText(draft: MentionDraft, text: string): MentionDraft {
  const before = draft.text;
  if (before === text) return draft;
  let prefix = 0;
  while (
    prefix < Math.min(before.length, text.length) &&
    before[prefix] === text[prefix]
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < Math.min(before.length, text.length) &&
    before[before.length - 1 - suffix] === text[text.length - 1 - suffix]
  )
    suffix++;
  const from = Math.min(prefix, before.length - suffix);
  const to = Math.max(prefix, before.length - suffix);
  const delta = text.length - before.length;
  const spans = draft.spans.flatMap((span) => {
    const next =
      span.end <= from
        ? span
        : span.start >= to
          ? { ...span, start: span.start + delta, end: span.end + delta }
          : undefined;
    return next &&
      next.start >= 0 &&
      next.end <= text.length &&
      !splitsPair(text, next.start) &&
      !splitsPair(text, next.end) &&
      text.slice(next.start, next.end) === before.slice(span.start, span.end)
      ? [next]
      : [];
  });
  return { text, spans };
}

export function activeMention(draft: MentionDraft, selection: Selection) {
  const caret = selection.start;
  if (
    caret !== selection.end ||
    caret < 0 ||
    caret > draft.text.length ||
    splitsPair(draft.text, caret)
  )
    return;
  for (let at = caret - 1; at >= Math.max(0, caret - 64); at--) {
    if (draft.text[at] === '\n') return;
    if (draft.text[at] !== '@') continue;
    if (
      (at > 0 && !/[\s([{"'“‘«,;:!?/]/u.test(draft.text[at - 1])) ||
      draft.spans.some((span) => at >= span.start && at < span.end)
    )
      return;
    const query = draft.text.slice(at + 1, caret);
    if (/^\s|\s{2}/u.test(query)) return;
    return { start: at, end: caret, query };
  }
}

export function insertMention(
  draft: MentionDraft,
  selection: Selection,
  member: Candidate,
) {
  const active = activeMention(draft, selection);
  if (!active) return;
  const label = `@${member.displayName}`;
  const insert = label + (/\s/u.test(draft.text[active.end] ?? '') ? '' : ' ');
  const text =
    draft.text.slice(0, active.start) + insert + draft.text.slice(active.end);
  const delta = insert.length - (active.end - active.start);
  const spans = draft.spans
    .filter((span) => span.end <= active.start || span.start >= active.end)
    .map((span) =>
      span.start >= active.end
        ? { ...span, start: span.start + delta, end: span.end + delta }
        : span,
    );
  spans.push({
    userId: member.userId,
    start: active.start,
    end: active.start + label.length,
  });
  spans.sort((a, b) => a.start - b.start);
  return { draft: { text, spans }, caret: active.start + insert.length };
}

export function contentError(text: string) {
  // class-validator IsLength counts surrogate pairs as one character.
  const size = [...text.trim()].length;
  return size < 1 || size > 2000 ? 'Enter 1–2000 characters.' : undefined;
}
export function finalizeDraft(
  draft: MentionDraft,
  names: ReadonlyMap<string, string>,
) {
  const content = draft.text.trim();
  const leading = draft.text.length - draft.text.trimStart().length;
  const mentions = draft.spans
    .map(({ userId, start, end }) => ({
      userId: userId.toLowerCase(),
      start: start - leading,
      end: end - leading,
    }))
    .sort((a, b) => a.start - b.start);
  const error = contentError(content);
  if (
    error ||
    !validSpans(content, mentions) ||
    mentions.some(
      (span) =>
        !names.has(span.userId) ||
        content.slice(span.start, span.end) !== `@${names.get(span.userId)}`,
    )
  ) {
    throw new ApiError('http', {
      status: 400,
      code: 'INVALID_COMMENT_INPUT',
      message:
        error ??
        'A mention changed or is unavailable. Reselect it or remove mention links.',
    });
  }
  return { content, mentions };
}

export const searchKey = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/gi, 'd')
    .toLocaleLowerCase();
