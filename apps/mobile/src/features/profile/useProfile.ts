import { useQuery } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useFocusEffect } from 'expo-router';
import { useSessionManager } from '../../infrastructure/auth/SessionProvider';
import { ApiError } from '../../infrastructure/api/errors';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { useCooldown } from '../auth/runtime';
import {
  canRetryWorkspace,
  useWorkspaceRetryReady,
} from '../workspaces/status';
import { profileOptions } from './api';
import { createAvatarApi } from './avatar-api';
import { transferAvatar, type Photo } from './avatar';
import { useAccountEnvironment } from './environment';
import {
  beginProfile,
  receiveProfile,
  validDisplayName,
  type ProfileDraft,
} from './model';
import { profileCommands } from './mutations';
import { avatarTransferPorts, selectPrivatePhoto } from './native-media';
import { profileError } from './status';

export function useProfile(identity: SessionIdentity) {
  const data = useMobileData(),
    manager = useSessionManager(),
    { online, eligible } = useAccountEnvironment();
  const commands = profileCommands(data, identity),
    mutation = useSyncExternalStore(commands.subscribe, commands.getSnapshot);
  const cooldown = useCooldown(mutation.retryAt);
  const query = useQuery({
    ...profileOptions(data, identity),
    enabled: ({ state }) =>
      eligible &&
      !mutation.pending &&
      !mutation.uncertain &&
      !cooldown &&
      canRetryWorkspace(state.error, state.errorUpdatedAt),
  });
  const readReady = useWorkspaceRetryReady(query.error, query.errorUpdatedAt);
  const [form, setForm] = useState<ProfileDraft | null>(null),
    [editing, setEditing] = useState(false),
    [notice, setNotice] = useState(''),
    [localError, setLocalError] = useState<unknown>(null),
    [phase, setPhase] = useState(''),
    [photo, setPhoto] = useState<Photo | null>(null);
  const selection = useRef<AbortController | null>(null),
    selected = useRef<Photo | null>(null),
    alive = useRef(true);
  const check = () => {
    data.assertCurrent(identity);
    if (!alive.current) throw new ApiError('aborted');
  };
  const clearPhoto = useCallback(() => {
    selected.current?.dispose();
    selected.current = null;
    setPhoto(null);
  }, []);
  useEffect(() => {
    if (query.data && !mutation.pending && !mutation.uncertain)
      setForm((old) =>
        old ? receiveProfile(old, query.data) : beginProfile(query.data),
      );
  }, [query.data, mutation.pending, mutation.uncertain]);
  useFocusEffect(
    useCallback(() => {
      alive.current = true;
      const stop = manager.addLifecycleListener({
        onSessionEnd: () => {
          selection.current?.abort();
          commands.abort();
          selected.current?.dispose();
          selected.current = null;
        },
      });
      return () => {
        alive.current = false;
        selection.current?.abort();
        selection.current = null;
        commands.abort();
        selected.current?.dispose();
        selected.current = null;
        stop();
        void data.queryClient.cancelQueries({
          queryKey: profileOptions(data, identity).queryKey,
          exact: true,
        });
      };
    }, [manager, commands, data, identity.userId, identity.generation]),
  );
  const pending = !!mutation.pending || !!phase;
  const dirty =
    !!photo ||
    (editing && !!form && form.text.trim() !== form.saved.displayName);
  const ready =
    eligible &&
    !pending &&
    !query.isFetching &&
    !mutation.uncertain &&
    !cooldown &&
    readReady;
  const fail = async (error: unknown) => {
    if (!alive.current || !manager.isCurrent(identity.generation)) return;
    setLocalError(error);
    if (
      error instanceof ApiError &&
      error.status === 409 &&
      !commands.getSnapshot().pending &&
      !commands.getSnapshot().uncertain
    )
      await query.refetch({ cancelRefetch: false });
  };
  async function fresh(
    api: Parameters<Parameters<typeof commands.run>[1]>[0],
    signal: AbortSignal,
  ) {
    try {
      return await api.get(signal);
    } catch (error) {
      if (error instanceof ApiError)
        throw new ApiError(error.kind, { ...error, requestStarted: false });
      throw new ApiError('invalid-response', { requestStarted: false });
    }
  }
  return {
    query,
    form,
    editing,
    mutation,
    notice,
    phase,
    photo,
    online,
    pending,
    dirty,
    cooldown,
    error: localError
      ? profileError(localError)
      : mutation.error
        ? profileError(mutation.error)
        : '',
    ready,
    canSave:
      ready &&
      editing &&
      !!form &&
      validDisplayName(form.text) &&
      form.text.trim() !== form.saved.displayName &&
      !form.conflict,
    edit() {
      if (!pending) {
        setEditing(true);
        setNotice('');
      }
    },
    text(value: string) {
      if (!pending) setForm((old) => old && { ...old, text: value });
    },
    acknowledge() {
      setForm((old) => old && { ...old, conflict: false });
    },
    cancel() {
      if (pending) return;
      clearPhoto();
      setForm((old) => old && beginProfile(old.saved));
      setEditing(false);
      setNotice('');
      setLocalError(null);
    },
    async refresh() {
      if (!eligible || pending || cooldown || !readReady) return;
      setLocalError(null);
      if (mutation.uncertain) {
        const controller = new AbortController();
        selection.current = controller;
        try {
          await commands.refresh(controller.signal);
        } catch (error) {
          await fail(error);
        } finally {
          selection.current = null;
        }
      } else await query.refetch({ cancelRefetch: false });
    },
    async save() {
      if (
        !ready ||
        commands.getSnapshot().pending ||
        !form ||
        !validDisplayName(form.text) ||
        form.conflict ||
        form.text.trim() === form.saved.displayName
      )
        return;
      setNotice('');
      setLocalError(null);
      try {
        const saved = await commands.run('name', async (api, signal) => {
          const current = await fresh(api, signal);
          if (current.displayName !== form.saved.displayName)
            throw new ApiError('http', {
              status: 409,
              code: 'PROFILE_CHANGED',
              requestStarted: false,
            });
          return api.patch(form.text, signal);
        });
        check();
        setForm(beginProfile(saved));
        setEditing(false);
        setNotice('Profile saved.');
      } catch (error) {
        await fail(error);
      }
    },
    async choose() {
      if (!ready || selection.current || commands.getSnapshot().pending) return;
      const controller = new AbortController();
      selection.current = controller;
      setPhase('Selecting photo…');
      setNotice('');
      setLocalError(null);
      try {
        const file = await selectPrivatePhoto(() => {
          check();
          if (controller.signal.aborted) throw new ApiError('aborted');
        }, controller.signal);
        try {
          check();
        } catch (error) {
          file?.dispose();
          throw error;
        }
        if (file) {
          clearPhoto();
          selected.current = file;
          setPhoto(file);
        }
      } catch (error) {
        await fail(error);
      } finally {
        if (alive.current) setPhase('');
        if (selection.current === controller) selection.current = null;
      }
    },
    clearPhoto,
    async retryAvatar() {
      if (!eligible || pending || cooldown || !mutation.recovery) return;
      setNotice('');
      setLocalError(null);
      try {
        await commands.retryAvatar();
        check();
        setNotice('Photo change confirmed.');
      } catch (error) {
        await fail(error);
      }
    },
    async upload() {
      if (
        !ready ||
        commands.getSnapshot().pending ||
        !selected.current ||
        !form
      )
        return;
      const file = selected.current;
      let completionStarted = false;
      setNotice('');
      setLocalError(null);
      try {
        await commands.run('photo', async (api, signal) => {
          const current = await fresh(api, signal);
          if (current.avatarRevision !== form.saved.avatarRevision)
            throw new ApiError('http', {
              status: 409,
              code: 'AVATAR_REVISION_CONFLICT',
              requestStarted: false,
            });
          const avatar = createAvatarApi(data.api, identity);
          try {
            setPhase('Requesting private upload…');
            const intent = await avatar.intent(
              file,
              current.avatarRevision,
              signal,
            );
            check();
            setPhase('Uploading photo…');
            await transferAvatar(
              avatar,
              intent,
              file,
              avatarTransferPorts,
              signal,
              () => {
                check();
                if (signal.aborted) throw new ApiError('aborted');
              },
            );
            check();
            setPhase('Verifying photo…');
            completionStarted = true;
            commands.rememberAvatar({
              kind: 'complete',
              uploadId: intent.uploadId,
              baseRevision: current.avatarRevision,
            });
            const result = await avatar.complete(intent.uploadId, signal);
            if (
              result.avatarRevision <= current.avatarRevision ||
              !result.avatarUrl
            )
              throw new ApiError('invalid-response');
            return result;
          } catch (error) {
            if (!completionStarted)
              throw error instanceof ApiError
                ? new ApiError(error.kind, { ...error, requestStarted: false })
                : new ApiError('network', { requestStarted: false });
            throw error;
          }
        });
        check();
        setNotice('Photo updated.');
      } catch (error) {
        await fail(error);
      } finally {
        if (alive.current) {
          setPhase('');
          clearPhoto();
        } else file.dispose();
      }
    },
    async remove() {
      if (
        !ready ||
        commands.getSnapshot().pending ||
        !form ||
        !form.saved.avatarUrl
      )
        return;
      setNotice('');
      setLocalError(null);
      try {
        await commands.run('remove photo', async (api, signal) => {
          const current = await fresh(api, signal);
          if (current.avatarRevision !== form.saved.avatarRevision)
            throw new ApiError('http', {
              status: 409,
              code: 'AVATAR_REVISION_CONFLICT',
              requestStarted: false,
            });
          commands.rememberAvatar({
            kind: 'remove',
            expectedRevision: current.avatarRevision,
          });
          const result = await createAvatarApi(data.api, identity).remove(
            current.avatarRevision,
            signal,
          );
          if (
            result.avatarUrl !== null ||
            result.avatarRevision <= current.avatarRevision
          )
            throw new ApiError('invalid-response');
          return result;
        });
        check();
        clearPhoto();
        setNotice('Photo removed.');
      } catch (error) {
        await fail(error);
      }
    },
  };
}
