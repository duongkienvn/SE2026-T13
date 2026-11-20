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
import { preferencesOptions } from './api';
import { emailEnabled } from './config';
import {
  beginDraft,
  cancelDraft,
  editDraft,
  receivePreferences,
  reconcileSave,
  type PreferencesDraft,
} from './draft';
import { equalPreferences, hasPatch, preferencesPatch } from './model';
import { preferenceCommands } from './mutations';

const subscribeFocus = focusManager.subscribe.bind(focusManager);
const foregroundSnapshot = () => focusManager.isFocused();
export function usePreferences(identity: SessionIdentity) {
  const data = useMobileData(),
    focused = useIsFocused(),
    online = useWorkspaceOnline();
  const foreground = useSyncExternalStore(subscribeFocus, foregroundSnapshot);
  const eligible = focused && foreground && online;
  const commands = preferenceCommands(data, identity, emailEnabled);
  const mutation = useSyncExternalStore(
    commands.subscribe,
    commands.getSnapshot,
  );
  const writeReady = useWorkspaceRetryReady(
    mutation.error,
    mutation.errorUpdatedAt,
  );
  const query = useQuery({
    ...preferencesOptions(data, identity),
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
  const [form, setForm] = useState<PreferencesDraft | null>(null),
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
        queryKey: preferencesOptions(data, identity).queryKey,
        exact: true,
      });
    };
  }, [commands, data, identity.userId, identity.generation]);
  useEffect(() => {
    if (query.data && !mutation.pending && !mutation.mustVerify) {
      setForm((previous) =>
        previous
          ? receivePreferences(previous, query.data, emailEnabled)
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
  const dirty =
    !!form && hasPatch(preferencesPatch(form.saved, form.draft, emailEnabled));
  const pending = !!mutation.pending;
  const canRefresh =
    eligible && !pending && !query.isFetching && writeReady && readReady;
  const canSave =
    canRefresh && dirty && !form?.conflict && !mutation.mustVerify;
  return {
    form,
    query,
    mutation,
    online,
    pending,
    dirty,
    canSave,
    canRefresh,
    emailEnabled,
    notice,
    edit(channel: 'inApp' | 'email', key: string, value: boolean) {
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
          previous && editDraft(previous, channel, key, value, emailEnabled),
      );
    },
    cancel() {
      if (commands.getSnapshot().pending) return;
      editRevision.current++;
      setNotice('');
      setForm((previous) => previous && cancelDraft(previous));
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
        preferencesOptions(data, identity).queryKey,
      );
      if (fresh && !equalPreferences(editing.saved, fresh)) {
        setForm(receivePreferences(editing, fresh, emailEnabled));
        setNotice(
          'Preferences changed. Review the latest server values before saving.',
        );
        return;
      }
      setNotice('');
      const revision = editRevision.current;
      try {
        const result = await commands.save(
          preferencesPatch(editing.saved, editing.draft, emailEnabled),
        );
        if (result && current()) {
          setForm((previous) =>
            reconcileSave(
              previous,
              editing,
              data.queryClient.getQueryData(
                preferencesOptions(data, identity).queryKey,
              ) ?? result,
              emailEnabled,
            ),
          );
          if (revision === editRevision.current)
            setNotice('Notification preferences saved.');
        }
      } catch {
        /* Preserve the draft; no success without a validated 200. */
      }
    },
  };
}
