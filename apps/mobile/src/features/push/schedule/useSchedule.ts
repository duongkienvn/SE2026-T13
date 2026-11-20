import type { UpdatePushSchedule } from '@kanban/shared';
import { focusManager, useQuery } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  sameIdentity,
  type SessionIdentity,
} from '../../../infrastructure/api/session-client';
import { useMobileData } from '../../../infrastructure/query/DataProvider';
import {
  useWorkspaceOnline,
  useWorkspaceRetryReady,
  canRetryWorkspace,
} from '../../workspaces/status';
import { scheduleOptions } from './api';
import {
  beginDraft,
  receiveSchedule,
  reconcileSave,
  type ScheduleDraft,
} from './model';
import { equalSchedule, hasPatch, schedulePatch, validSchedule } from './model';
import { scheduleCommands } from './mutations';

const subscribeFocus = focusManager.subscribe.bind(focusManager);
const foregroundSnapshot = () => focusManager.isFocused();
export function useSchedule(identity: SessionIdentity) {
  const data = useMobileData(),
    focused = useIsFocused(),
    online = useWorkspaceOnline();
  const foreground = useSyncExternalStore(subscribeFocus, foregroundSnapshot);
  const eligible = focused && foreground && online;
  const commands = scheduleCommands(data, identity);
  const mutation = useSyncExternalStore(
    commands.subscribe,
    commands.getSnapshot,
  );
  const writeReady = useWorkspaceRetryReady(
    mutation.error,
    mutation.errorUpdatedAt,
  );
  const query = useQuery({
    ...scheduleOptions(data, identity),
    enabled: ({ state }) => {
      const command = commands.getSnapshot();
      return (
        eligible &&
        !command.pending &&
        !command.mustVerify &&
        writeReady &&
        canRetryWorkspace(state.error, state.errorUpdatedAt)
      );
    },
  });
  const readReady = useWorkspaceRetryReady(query.error, query.errorUpdatedAt);
  const [form, setForm] = useState<ScheduleDraft | null>(null),
    [notice, setNotice] = useState('');
  const mounted = useRef(true),
    latest = useRef(form),
    editRevision = useRef(0);
  useLayoutEffect(() => {
    latest.current = form;
  }, [form]);
  const current = () =>
    mounted.current && sameIdentity(identity, data.getIdentity());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      commands.abort();
      void data.queryClient.cancelQueries({
        queryKey: scheduleOptions(data, identity).queryKey,
        exact: true,
      });
    };
  }, [commands, data, identity.userId, identity.generation]);
  useEffect(() => {
    if (query.data && !mutation.pending && !mutation.mustVerify) {
      setForm((previous) =>
        previous
          ? receiveSchedule(previous, query.data)
          : beginDraft(query.data),
      );
    }
  }, [query.data, mutation.pending, mutation.mustVerify]);
  const wasEligible = useRef(false),
    recoveryRequested = useRef(false);
  // Keep one entry/reconnect/resume check through a pending PATCH. A read can
  // observe values, never prove settlement or automatically unlock another write.
  useEffect(() => {
    if (eligible && !wasEligible.current) recoveryRequested.current = true;
    wasEligible.current = eligible;
    if (!eligible) return;
    const command = commands.getSnapshot();
    if (command.pending === 'save') return;
    if (!command.mustVerify || command.pending === 'verify') {
      recoveryRequested.current = false;
      return;
    }
    if (!recoveryRequested.current || !writeReady || !readReady) return;
    recoveryRequested.current = false;
    void commands.verify().catch(() => undefined);
  }, [
    eligible,
    commands,
    mutation.pending,
    mutation.mustVerify,
    writeReady,
    readReady,
  ]);
  const dirty = !!form && hasPatch(schedulePatch(form.saved, form.draft));
  const pending = !!mutation.pending;
  const canRefresh =
    eligible && !pending && !query.isFetching && writeReady && readReady;
  const canSave =
    canRefresh &&
    dirty &&
    !!form &&
    validSchedule(form.draft) &&
    !form.conflict &&
    !mutation.mustVerify;
  return {
    form,
    query,
    mutation,
    online,
    pending,
    dirty,
    canSave,
    canRefresh,

    notice,
    edit(patch: UpdatePushSchedule) {
      if (
        !eligible ||
        commands.getSnapshot().pending ||
        commands.getSnapshot().mustVerify
      )
        return;
      setNotice('');
      editRevision.current++;
      setForm(
        (previous) =>
          previous && { ...previous, draft: { ...previous.draft, ...patch } },
      );
    },
    cancel() {
      if (commands.getSnapshot().pending) return;
      editRevision.current++;
      setNotice('');
      setForm((previous) => previous && beginDraft(previous.saved));
    },
    acknowledge() {
      if (commands.getSnapshot().pending) return;
      editRevision.current++;
      setForm((previous) => previous && { ...previous, conflict: false });
      setNotice(
        'Your edits are kept. Save changes to apply only those choices.',
      );
    },
    async refresh() {
      if (!canRefresh) return;
      setNotice('');
      if (commands.getSnapshot().mustVerify) {
        try {
          await commands.verify();
          if (current()) {
            setNotice(
              'Server values checked. The earlier save is still unconfirmed; saving remains blocked. Your draft is unchanged.',
            );
          }
        } catch {
          /* The command exposes a safe retry state. */
        }
      } else await query.refetch({ cancelRefetch: false });
    },
    async save() {
      const editing = latest.current;
      if (
        !canSave ||
        !editing ||
        editing.conflict ||
        commands.getSnapshot().pending
      )
        return;
      const fresh = data.queryClient.getQueryData(
        scheduleOptions(data, identity).queryKey,
      );
      if (fresh && !equalSchedule(editing.saved, fresh)) {
        setForm(receiveSchedule(editing, fresh));
        setNotice(
          'Quiet hours or account timezone changed. Review the latest server values before saving.',
        );
        return;
      }
      setNotice('');
      const revision = editRevision.current;
      try {
        const result = await commands.save(
          schedulePatch(editing.saved, editing.draft),
        );
        if (result && current()) {
          setForm((previous) =>
            reconcileSave(
              previous,
              editing,
              data.queryClient.getQueryData(
                scheduleOptions(data, identity).queryKey,
              ) ?? result,
            ),
          );
          if (revision === editRevision.current)
            setNotice('Quiet hours saved.');
        }
      } catch {
        /* Preserve the draft; no success without a validated 200. */
      }
    },
  };
}
