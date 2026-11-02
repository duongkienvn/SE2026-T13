import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BoardBackgroundPreset } from '@kanban/shared';
import { Dialog } from '../../../components/Dialog';
import { Button } from '../../../components/Button';
import { apiRequest, isApiError } from '../../../lib/api-client';
import { useAuth } from '../../auth/useAuth';
import { useAuthSession } from '../../auth/auth-session-context';
import { workspaceKeys } from '../../workspaces/query-keys';
import { getBoard } from '../api';
import { boardKeys } from '../query-keys';
import type { Board } from '../types';
import { boardAccessVersion } from '../access-version';
import { revokeBoardAccess } from '../revoke-board-access';

const photos = ['mountains', 'forest', 'coast', 'lake'];
export function backgroundStyle(preset: BoardBackgroundPreset | undefined) {
  if (!preset) return undefined;
  if (preset.kind === 'color') return { backgroundColor: preset.value };
  if (!photos.includes(preset.id)) return undefined;
  return {
    backgroundColor: '#334155',
    backgroundImage: `linear-gradient(#0004, #0004), url('/board-backgrounds/${preset.id}.jpg')`,
    backgroundPosition: 'center',
    backgroundSize: 'cover',
  };
}

export function useBackgroundPresets() {
  const { user, runAuthorized } = useAuth();
  const scope = useAuthSession();
  return useQuery({
    queryKey: ['board-discovery', user?.id, scope.generation, 'presets'],
    queryFn: async ({ signal }) => {
      const presets = await runAuthorized((accessToken) =>
        apiRequest<BoardBackgroundPreset[]>('/boards/background-presets', {
          accessToken,
          signal,
        }),
      );
      if (!Array.isArray(presets)) throw new Error('Backgrounds unavailable');
      return presets;
    },
    enabled: !!user,
    retry: false,
  });
}

export function BoardBackgroundDialog({
  board,
  canManage,
  onClose,
}: {
  board: Board;
  canManage: boolean;
  onClose: () => void;
}) {
  const presets = useBackgroundPresets();
  const { user, runAuthorized } = useAuth();
  const scope = useAuthSession();
  const client = useQueryClient();
  const [initial] = useState(board.backgroundPreset ?? 'blue');
  const [initialVersion] = useState(board.backgroundVersion);
  const [selected, setSelected] = useState(initial);
  const [category, setCategory] = useState<'color' | 'photo'>('color');
  const conflict =
    (board.backgroundPreset ?? 'blue') !== initial ||
    board.backgroundVersion !== initialVersion;
  const save = useMutation({
    onMutate: () => boardAccessVersion(client, board.id),
    mutationFn: () =>
      runAuthorized(async (accessToken) => {
        const accessVersion = boardAccessVersion(client, board.id);
        const current = await getBoard(accessToken, board.id);
        if (
          !scope.isCurrent() ||
          accessVersion !== boardAccessVersion(client, board.id)
        )
          throw new Error('Board access changed.');
        if (
          initialVersion === undefined ||
          current.backgroundVersion !== initialVersion ||
          (current.backgroundPreset ?? 'blue') !== initial ||
          current.isArchived ||
          current.capabilities?.canManageBoard !== true
        ) {
          void client.invalidateQueries({
            queryKey: boardKeys.detail(board.id),
          });
          void client.invalidateQueries({ queryKey: boardKeys.lists() });
          throw new Error(
            'Board changed or permission was lost. Close and reopen to review it.',
          );
        }
        return apiRequest<Board>(
          `/boards/${encodeURIComponent(board.id)}/background`,
          {
            method: 'PATCH',
            accessToken,
            body: { preset: selected, expectedVersion: initialVersion },
          },
        );
      }),
    onSuccess: (_saved, _input, accessVersion) => {
      if (
        !scope.isCurrent() ||
        accessVersion !== boardAccessVersion(client, board.id)
      )
        return;
      void client.invalidateQueries({ queryKey: boardKeys.detail(board.id) });
      void client.invalidateQueries({ queryKey: boardKeys.lists() });
      void client.invalidateQueries({
        queryKey: workspaceKeys.session(user?.id ?? '', scope.generation),
      });
      onClose();
    },
    onError: (error, _input, accessVersion) => {
      if (
        !scope.isCurrent() ||
        accessVersion !== boardAccessVersion(client, board.id) ||
        !isApiError(error)
      )
        return;
      if (error.status === 404) revokeBoardAccess(client, board.id);
      else if (error.status === 403 || error.status === 409) {
        void client.invalidateQueries({ queryKey: boardKeys.detail(board.id) });
        void client.invalidateQueries({ queryKey: boardKeys.lists() });
      }
    },
  });
  const choice = presets.data?.find((item) => item.id === selected);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Change background"
      dismissible={!save.isPending}
    >
      <div
        className="h-32 rounded-lg border border-line bg-app"
        style={backgroundStyle(choice)}
        aria-label={`Preview: ${selected}`}
      />
      <div
        role="group"
        aria-label="Background category"
        className="mt-4 flex gap-2"
      >
        {(['color', 'photo'] as const).map((kind) => (
          <Button
            key={kind}
            variant={category === kind ? 'primary' : 'secondary'}
            aria-pressed={category === kind}
            onClick={() => setCategory(kind)}
          >
            {kind === 'color' ? 'Colors' : 'Photos'}
          </Button>
        ))}
      </div>
      {presets.isError && (
        <p role="alert" className="mt-4 text-danger">
          Backgrounds unavailable.{' '}
          <button type="button" onClick={() => void presets.refetch()}>
            Retry
          </button>
        </p>
      )}
      {presets.isPending && <p role="status">Loading backgrounds…</p>}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {presets.data
          ?.filter(
            (item) =>
              item.kind === category &&
              (item.kind !== 'photo' || photos.includes(item.id)),
          )
          .map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={selected === item.id}
              onClick={() => setSelected(item.id)}
              className="rounded-lg border border-line p-1 text-left focus-visible:outline-2 focus-visible:outline-primary"
            >
              <span
                className="block h-16 rounded"
                style={backgroundStyle(item)}
              />
              <span className="block p-1 text-sm capitalize">
                {item.id}
                {selected === item.id ? ' ✓' : ''}
              </span>
            </button>
          ))}
      </div>
      {(conflict || !canManage) && (
        <p role="alert" className="mt-4 text-danger">
          The Board changed or editing permission was lost. Close and reopen to
          review it.
        </p>
      )}
      {initialVersion === undefined && (
        <p role="alert" className="mt-4 text-danger">
          Background editing is unavailable until the Board service is updated.
        </p>
      )}
      {save.isError && (
        <p role="alert" className="mt-4 text-danger">
          {save.error.message || 'Could not save background. Try again.'}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
        <Button
          onClick={() => save.mutate()}
          disabled={
            !canManage ||
            initialVersion === undefined ||
            conflict ||
            save.isPending ||
            selected === initial ||
            !choice
          }
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Dialog>
  );
}
