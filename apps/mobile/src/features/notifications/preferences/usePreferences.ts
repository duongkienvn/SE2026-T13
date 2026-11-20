import { focusManager, useQuery } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  sameIdentity,
  type SessionIdentity,
} from '../../../infrastructure/api/session-client';
import { useMobileData } from '../../../infrastructure/query/DataProvider';
import {
  useWorkspaceOnline,
  useWorkspaceRetryReady,
} from '../../workspaces/status';
import { preferencesOptions } from './api';
import { emailEnabled } from './config';
import {
  beginDraft,
  cancelDraft,
  editDraft,
  receivePreferences,
  type PreferencesDraft,
} from './draft';
import { hasPatch, preferencesPatch } from './model';
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
    enabled:
      eligible && !mutation.pending && !mutation.mustVerify && writeReady,
  });
  const readReady = useWorkspaceRetryReady(query.error, query.errorUpdatedAt);
  const [form, setForm] = useState<PreferencesDraft | null>(null),
    [notice, setNotice] = useState('');
  const mounted = useRef(true),
    latest = useRef(form);
  latest.current = form;
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
  // Recover uncertain writes on entry/reconnect/resume, once per eligibility edge.
  useEffect(() => {
    if (
      eligible &&
      commands.getSnapshot().mustVerify &&
      !commands.getSnapshot().pending &&
      writeReady &&
      readReady
    )
      void commands.verify().catch(() => undefined);
  }, [eligible, commands, writeReady, readReady]);
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
      setForm(
        (previous) =>
          previous && editDraft(previous, channel, key, value, emailEnabled),
      );
    },
    cancel() {
      if (commands.getSnapshot().pending) return;
      setNotice('');
      setForm((previous) => previous && cancelDraft(previous));
    },
    acknowledge() {
      if (commands.getSnapshot().pending) return;
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
          const result = await commands.verify();
          if (current()) {
            setForm((previous) =>
              previous
                ? receivePreferences(previous, result, emailEnabled)
                : beginDraft(result),
            );
            setNotice(
              'Latest preferences loaded. Review your choices before saving again.',
            );
          }
        } catch {
          /* The command exposes a safe retry state. */
        }
      } else await query.refetch({ cancelRefetch: false });
    },
    async save() {
      const editing = latest.current;
      if (!canSave || !editing || commands.getSnapshot().pending) return;
      setNotice('');
      try {
        const result = await commands.save(
          preferencesPatch(editing.saved, editing.draft, emailEnabled),
        );
        if (result && current()) {
          setForm(beginDraft(result));
          setNotice('Notification preferences saved.');
        }
      } catch {
        /* Preserve the draft; no success without a validated 200. */
      }
    },
  };
}
