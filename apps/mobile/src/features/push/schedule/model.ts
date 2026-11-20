import type { PushSchedule, UpdatePushSchedule } from '@kanban/shared';
import {
  ApiError,
  invalidResponse,
} from '../../../infrastructure/api/errors.ts';
export const clockPattern = /^(?:[01]\d|2[0-3]):(?:00|15|30|45)$/;
export const editableKeys = ['enabled', 'startLocal', 'endLocal'] as const;
export const timeChoices = Array.from(
  { length: 96 },
  (_, index) =>
    `${String(Math.floor(index / 4)).padStart(2, '0')}:${String((index % 4) * 15).padStart(2, '0')}`,
);
function object(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}
export function validSchedule(
  value: Pick<PushSchedule, 'enabled' | 'startLocal' | 'endLocal'>,
) {
  return (
    typeof value.enabled === 'boolean' &&
    value.startLocal.length === 5 &&
    clockPattern.test(value.startLocal) &&
    value.endLocal.length === 5 &&
    clockPattern.test(value.endLocal) &&
    (!value.enabled || value.startLocal !== value.endLocal)
  );
}
export function decodeSchedule(value: unknown): PushSchedule {
  if (
    !object(value) ||
    Object.keys(value).length !== 4 ||
    ![...editableKeys, 'timeZone'].every((key) => Object.hasOwn(value, key)) ||
    typeof value.enabled !== 'boolean' ||
    typeof value.startLocal !== 'string' ||
    typeof value.endLocal !== 'string' ||
    typeof value.timeZone !== 'string' ||
    !value.timeZone ||
    value.timeZone.length > 100
  )
    throw invalidResponse(200);
  const result = {
    enabled: value.enabled,
    startLocal: value.startLocal,
    endLocal: value.endLocal,
    timeZone: value.timeZone,
  };
  if (!validSchedule(result)) throw invalidResponse(200);
  try {
    new Intl.DateTimeFormat('en', { timeZone: result.timeZone });
  } catch {
    throw invalidResponse(200);
  }
  return result;
}
export function validatePatch(value: unknown): UpdatePushSchedule {
  if (
    !object(value) ||
    !Object.keys(value).length ||
    Object.entries(value).some(([key, leaf]) =>
      key === 'enabled'
        ? typeof leaf !== 'boolean'
        : !['startLocal', 'endLocal'].includes(key) ||
          typeof leaf !== 'string' ||
          leaf.length !== 5 ||
          !clockPattern.test(leaf),
    )
  )
    throw new ApiError('configuration');
  return { ...value };
}
export function schedulePatch(
  saved: PushSchedule,
  draft: PushSchedule,
): UpdatePushSchedule {
  return Object.fromEntries(
    editableKeys
      .filter((key) => saved[key] !== draft[key])
      .map((key) => [key, draft[key]]),
  );
}
export const hasPatch = (patch: UpdatePushSchedule) =>
  Object.keys(patch).length > 0;
export const equalSchedule = (a: PushSchedule, b: PushSchedule) =>
  !hasPatch(schedulePatch(a, b)) && a.timeZone === b.timeZone;
export type ScheduleDraft = {
  saved: PushSchedule;
  draft: PushSchedule;
  conflict: boolean;
};
export const beginDraft = (value: PushSchedule): ScheduleDraft => ({
  saved: { ...value },
  draft: { ...value },
  conflict: false,
});
/** Fresh untouched values and timezone replace only baseline; never local intent. */
export function receiveSchedule(
  state: ScheduleDraft,
  fresh: PushSchedule,
): ScheduleDraft {
  const intent = schedulePatch(state.saved, state.draft);
  if (!hasPatch(intent)) return beginDraft(fresh);
  const draft = { ...fresh, ...intent };
  return {
    saved: fresh,
    draft,
    conflict:
      hasPatch(schedulePatch(fresh, draft)) &&
      (state.conflict || !equalSchedule(state.saved, fresh)),
  };
}
export function reconcileSave(
  current: ScheduleDraft | null,
  submitted: ScheduleDraft,
  authoritative: PushSchedule,
): ScheduleDraft {
  if (!current || current === submitted) return beginDraft(authoritative);
  if (equalSchedule(current.saved, submitted.saved))
    return {
      ...beginDraft(authoritative),
      draft: {
        ...authoritative,
        ...schedulePatch(submitted.draft, current.draft),
      },
    };
  return receiveSchedule(current, authoritative);
}
