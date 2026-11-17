import { useQuery } from '@tanstack/react-query';
import { useLayoutEffect, useRef, useState } from 'react';
import { ApiError } from '../../../infrastructure/api/errors';
import { sameIdentity } from '../../../infrastructure/api/session-client';
import { useMobileData } from '../../../infrastructure/query/DataProvider';
import { queryKeys } from '../../../infrastructure/query/keys';
import type { CardDetailContext } from '../detail/sections';
import type { CardChecklists } from './api';
import {
  checklistOptions,
  runChecklistWrite,
  type ChecklistWrite,
} from './queries';

export function useChecklists(context: CardDetailContext) {
  const data = useMobileData();
  return useQuery({
    ...checklistOptions(data, context),
    enabled: context.active,
  });
}

type Pending = {
  itemId?: string;
  desired?: boolean;
  settling: boolean;
  snapshot?: CardChecklists;
};

export function useChecklistMutation(context: CardDetailContext) {
  const data = useMobileData();
  const { identity, canEdit, active } = context;
  const permission = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const job = useRef<Pending | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  useLayoutEffect(() => {
    permission.current = active && canEdit;
  }, [active, canEdit]);
  useLayoutEffect(() => () => controller.current?.abort(), []);

  async function run(
    command:
      | Exclude<ChecklistWrite, { kind: 'toggle' }>
      | {
          kind: 'toggle';
          checklistId: string;
          itemId: string;
          isChecked: boolean;
        },
  ) {
    const running = job.current;
    if (running) {
      if (
        permission.current &&
        command.kind === 'toggle' &&
        running.itemId === command.itemId &&
        !running.settling
      ) {
        running.desired = !running.desired;
        setPending({ ...running });
      }
      return false;
    }
    const task: Pending =
      command.kind === 'toggle'
        ? {
            itemId: command.itemId,
            desired: command.isChecked,
            settling: false,
          }
        : { settling: false };
    const lifetime = new AbortController();
    task.snapshot = data.queryClient.getQueryData(
      queryKeys.checklists(identity, context.boardId, context.cardId),
    );
    job.current = task;
    controller.current = lifetime;
    setPending({ ...task });
    const alive = () =>
      !lifetime.signal.aborted && sameIdentity(identity, data.getIdentity());
    try {
      await runChecklistWrite(
        data,
        context,
        command.kind === 'toggle'
          ? { ...command, intent: () => task.desired! }
          : command,
        () => permission.current,
        lifetime.signal,
        () => {
          task.settling = true;
          if (alive()) setPending({ ...task });
        },
      );
      if (!alive()) throw new ApiError('session-changed');
      return true;
    } finally {
      job.current = null;
      controller.current = null;
      if (alive()) setPending(null);
    }
  }
  return { pending, run };
}
