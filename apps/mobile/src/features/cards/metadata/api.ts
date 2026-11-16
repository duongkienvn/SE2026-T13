import type {
  SessionHttpClient,
  SessionIdentity,
} from '../../../infrastructure/api/session-client.ts';
import {
  ApiError,
  invalidResponse,
} from '../../../infrastructure/api/errors.ts';
import { isUuid } from '../../../infrastructure/auth/credential-record.ts';
import { queryKeys } from '../../../infrastructure/query/keys.ts';
import {
  decodeKanbanLabel,
  type KanbanLabel,
} from '../../boards/kanban-api.ts';
import { decodeCardAssignee } from '../decoder.ts';

export type LabelFields = Pick<KanbanLabel, 'name' | 'color'>;

function invalid(message: string): never {
  throw new ApiError('http', {
    status: 400,
    code: 'INVALID_METADATA_INPUT',
    message,
  });
}

function id(value: string) {
  if (!isUuid(value)) invalid('Select a valid item from this board.');
  return value.toLowerCase();
}

function labelName(value: unknown) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (![...name].length || [...name].length > 120)
    invalid('Enter a label name between 1 and 120 characters.');
  return name;
}

function labelColor(value: unknown) {
  const color = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!/^#[0-9A-F]{6}$/.test(color))
    invalid('Enter a color with six hex digits, such as #615CF7.');
  return color;
}

export function labelFields(input: Readonly<LabelFields>): LabelFields {
  return { name: labelName(input.name), color: labelColor(input.color) };
}

export function labelPatch(
  next: LabelFields,
  previous: LabelFields,
): Partial<LabelFields> {
  return {
    ...(next.name !== previous.name && { name: next.name }),
    ...(next.color !== previous.color && { color: next.color }),
  };
}

export function createMetadataApi(
  api: SessionHttpClient,
  identity: SessionIdentity,
  boardId: string,
  cardId: string,
) {
  const board = id(boardId);
  const card = id(cardId);
  const boardPath = `/boards/${board}/labels`;
  const cardPath = `/boards/${board}/cards/${card}`;
  // Association-level errors verify Board access without evicting unrelated reads.
  const writeKey = [
    ...queryKeys.card(identity, board, card),
    'metadata-write',
  ] as const;
  const boardWriteKey = [
    ...queryKeys.board(identity, board),
    'label-write',
  ] as const;
  const readKey = queryKeys.cardLabels(identity, board, card);
  function decodeLabels(value: unknown, status: number) {
    const dto = value as { cardId?: unknown; labels?: unknown } | null;
    if (
      !isUuid(dto?.cardId) ||
      dto.cardId.toLowerCase() !== card ||
      !Array.isArray(dto.labels)
    )
      throw invalidResponse(status);
    const labels = dto.labels.map((label: unknown) =>
      decodeKanbanLabel(label, board, status),
    );
    if (new Set(labels.map((label) => label.id)).size !== labels.length)
      throw invalidResponse(status);
    return labels;
  }

  return {
    labels(signal: AbortSignal) {
      return api.json(
        `${cardPath}/labels`,
        (value) => decodeLabels(value, 200),
        {
          identity,
          signal,
          resourceKey: readKey,
          expectedStatus: 200,
          retries: 0,
        },
      );
    },
    assignMember(userId: string, signal: AbortSignal) {
      const expected = id(userId);
      return api.json(
        `${cardPath}/assignees`,
        (value) => {
          const result = decodeCardAssignee(value, 201);
          if (result.userId !== expected) throw invalidResponse(201);
          return result;
        },
        {
          identity,
          signal,
          resourceKey: writeKey,
          method: 'POST',
          body: { userId: expected },
          expectedStatus: 201,
          retries: 0,
        },
      );
    },
    unassignMember(userId: string, signal: AbortSignal) {
      return api.empty(`${cardPath}/assignees/${id(userId)}`, {
        identity,
        signal,
        resourceKey: writeKey,
        method: 'DELETE',
        expectedStatus: 204,
        retries: 0,
      });
    },
    assignLabel(labelId: string, signal: AbortSignal) {
      const expected = id(labelId);
      return api.json(
        `${cardPath}/labels`,
        (value) => {
          const labels = decodeLabels(value, 201);
          if (!labels.some((label) => label.id === expected))
            throw invalidResponse(201);
          return labels;
        },
        {
          identity,
          signal,
          resourceKey: writeKey,
          method: 'POST',
          body: { labelId: expected },
          expectedStatus: 201,
          retries: 0,
        },
      );
    },
    unassignLabel(labelId: string, signal: AbortSignal) {
      return api.empty(`${cardPath}/labels/${id(labelId)}`, {
        identity,
        signal,
        resourceKey: writeKey,
        method: 'DELETE',
        expectedStatus: 204,
        retries: 0,
      });
    },
    createLabel(input: LabelFields, signal: AbortSignal) {
      return api.json(
        boardPath,
        (value) => decodeKanbanLabel(value, board, 201),
        {
          identity,
          signal,
          resourceKey: boardWriteKey,
          method: 'POST',
          body: labelFields(input),
          expectedStatus: 201,
          retries: 0,
        },
      );
    },
    updateLabel(
      labelId: string,
      input: Partial<LabelFields>,
      signal: AbortSignal,
    ) {
      const expected = id(labelId);
      const body = {
        ...(input.name !== undefined && { name: labelName(input.name) }),
        ...(input.color !== undefined && { color: labelColor(input.color) }),
      };
      if (!Object.keys(body).length) invalid('Change the label name or color.');
      return api.json(
        `${boardPath}/${expected}`,
        (value) => {
          const label = decodeKanbanLabel(value, board);
          if (label.id !== expected) throw invalidResponse(200);
          return label;
        },
        {
          identity,
          signal,
          resourceKey: boardWriteKey,
          method: 'PATCH',
          body,
          expectedStatus: 200,
          retries: 0,
        },
      );
    },
    deleteLabel(labelId: string, signal: AbortSignal) {
      return api.empty(`${boardPath}/${id(labelId)}`, {
        identity,
        signal,
        resourceKey: boardWriteKey,
        method: 'DELETE',
        expectedStatus: 204,
        retries: 0,
      });
    },
  };
}
