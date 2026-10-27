import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { ApiError } from '../../../lib/api-client';
import { currentUserQueryKey } from '../AuthProvider';
import { useAuthSession } from '../auth-session-context';
import {
  AVATAR_TYPES,
  MAX_AVATAR_BYTES,
  requestAvatarUpload,
  completeAvatarUpload,
  transferAvatar,
  removeAvatar,
} from '../avatar-api';
import { useAuth } from '../useAuth';
import type { User } from '../types';
import { UserAvatar } from './UserAvatar';

export function AvatarEditor({
  user,
  onDirtyChange,
  onBusyChange,
}: {
  user: User;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { runAuthorized } = useAuth();
  const scope = useAuthSession();
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const operation = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(
    null,
  );
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [stage, setStage] = useState('Uploading photo…');
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      operation.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview({ file, url });
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const mutation = useMutation({
    mutationFn: async (action: 'upload' | 'remove') => {
      if (!alive.current || !scope.isCurrent())
        throw new Error('Session changed.');
      operation.current = new AbortController();
      const signal = operation.current.signal;
      if (action === 'remove')
        return runAuthorized((token) =>
          removeAvatar(token, user.avatarRevision ?? 0, signal),
        );
      if (!file) throw new Error('Choose a photo.');
      setStage('Uploading photo…');
      const intent = await runAuthorized((token) =>
        requestAvatarUpload(token, file, user.avatarRevision ?? 0, signal),
      );
      if (!alive.current || signal.aborted || !scope.isCurrent())
        throw new Error('Session changed.');
      if (intent.upload.kind === 'memory')
        await runAuthorized((token) =>
          transferAvatar(intent, file, signal, token),
        );
      else await transferAvatar(intent, file, signal);
      if (!alive.current || signal.aborted || !scope.isCurrent())
        throw new Error('Session changed.');
      setStage('Verifying photo…');
      return runAuthorized((token) =>
        completeAvatarUpload(token, intent.uploadId, signal),
      );
    },
    onSuccess: async (updated, action) => {
      if (!alive.current || !scope.isCurrent()) return;
      await client.cancelQueries({ queryKey: currentUserQueryKey });
      if (!alive.current || !scope.isCurrent()) return;
      client.setQueryData<User>(currentUserQueryKey, (current) => {
        if (
          !current ||
          current.id !== updated.id ||
          (current.avatarRevision ?? 0) > (updated.avatarRevision ?? 0)
        )
          return current;
        return {
          ...current,
          avatarUrl: updated.avatarUrl,
          avatarRevision: updated.avatarRevision,
        };
      });
      setFile(null);
      onDirtyChange(false);
      setNotice(action === 'upload' ? 'Photo saved.' : 'Photo removed.');
    },
    onError: (failure) => {
      if (!alive.current || !scope.isCurrent()) return;
      setError(
        failure instanceof ApiError
          ? failure.message
          : 'Could not save your photo. Try again.',
      );
      if (failure instanceof ApiError && failure.status === 409)
        void client.invalidateQueries({ queryKey: currentUserQueryKey });
    },
    onSettled: () => {
      if (alive.current) onBusyChange(false);
    },
  });
  const start = (action: 'upload' | 'remove') => {
    if (mutation.isPending) return;
    setError(undefined);
    setNotice(undefined);
    onBusyChange(true);
    mutation.mutate(action);
  };
  const choose = (selected: File | undefined) => {
    if (!selected) return;
    setNotice(undefined);
    setError(undefined);
    setFile(null);
    onDirtyChange(false);
    if (!AVATAR_TYPES.includes(selected.type)) {
      setError('Choose a JPEG, PNG or WebP photo.');
      return;
    }
    if (!selected.size || selected.size > MAX_AVATAR_BYTES) {
      setError('Choose a photo no larger than 5 MiB.');
      return;
    }
    setFile(selected);
    onDirtyChange(true);
  };
  return (
    <section
      aria-label="Profile photo"
      className="space-y-4 border-b border-line pb-6"
    >
      <div className="flex min-w-0 items-center gap-4">
        <UserAvatar
          user={
            file && preview?.file === file
              ? { displayName: user.displayName, avatarUrl: preview.url }
              : user
          }
          className="size-16 text-xl md:size-20 md:text-2xl"
        />
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-ink">
            {user.displayName}
          </p>
          <p className="truncate text-sm text-muted">{user.email}</p>
        </div>
      </div>
      <input
        ref={input}
        aria-label="Photo file"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={mutation.isPending}
        tabIndex={-1}
        className="sr-only"
        onChange={(event) => {
          choose(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      <div className="flex flex-wrap gap-2 [&>button]:min-h-11">
        <Button
          type="button"
          variant="secondary"
          disabled={mutation.isPending}
          onClick={() => input.current?.click()}
        >
          {user.avatarUrl || file ? 'Change photo' : 'Select photo'}
        </Button>
        {user.avatarUrl && !file && (
          <Button
            type="button"
            variant="secondary"
            disabled={mutation.isPending}
            onClick={() => start('remove')}
          >
            Remove photo
          </Button>
        )}
        {file && (
          <>
            <Button
              type="button"
              disabled={mutation.isPending}
              onClick={() => start('upload')}
            >
              {mutation.isPending ? stage : 'Upload photo'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={mutation.isPending}
              onClick={() => {
                setFile(null);
                setError(undefined);
                setNotice(undefined);
                onDirtyChange(false);
              }}
            >
              Cancel photo
            </Button>
          </>
        )}
      </div>
      <p className="break-words text-xs text-muted">
        JPEG, PNG or WebP · up to 5 MiB.{' '}
        {file
          ? `${file.name} selected. Preview only until uploaded.`
          : 'Your photo is shared with authorized board members.'}
      </p>
      {mutation.isPending && (
        <p role="status" className="text-sm text-muted">
          {file ? stage : 'Removing photo…'}
        </p>
      )}
      {notice && <Alert variant="success">{notice}</Alert>}
      {error && <Alert variant="error">{error}</Alert>}
    </section>
  );
}
