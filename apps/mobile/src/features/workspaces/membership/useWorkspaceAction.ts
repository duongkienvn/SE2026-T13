import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../../infrastructure/api/errors';
import { sameIdentity } from '../../../infrastructure/api/session-client';
import { useMobileData } from '../../../infrastructure/query/DataProvider';
import { useWorkspaceRetryReady, workspaceErrorMessage } from '../status';
import type { WorkspaceCollaborationContext } from './WorkspaceCollaborationScreen';
import { uncertainWorkspaceWrite } from './mutations';

export function useWorkspaceAction(context: WorkspaceCollaborationContext) {
  const data = useMobileData();
  const request = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ error: unknown; time: number }>();
  const [mustReview, setMustReview] = useState(false);
  const retry = useWorkspaceRetryReady(failure?.error, failure?.time ?? 0);
  useEffect(() => () => request.current?.abort(), []);

  async function run<T>(
    write: (controller: AbortSignal) => Promise<T>,
    success?: (value: T) => void,
  ) {
    if (
      request.current ||
      !retry ||
      mustReview ||
      !context.active ||
      !context.online
    )
      return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setFailure(undefined);
    const current = () =>
      !controller.signal.aborted &&
      sameIdentity(context.identity, data.getIdentity());
    try {
      const response = await write(controller.signal);
      if (current()) success?.(response);
    } catch (error) {
      if (!current()) return;
      setFailure({ error, time: Date.now() });
      if (uncertainWorkspaceWrite(error)) setMustReview(true);
    } finally {
      if (request.current === controller) request.current = null;
      if (current()) setPending(false);
    }
  }
  const error = failure?.error;
  return {
    run,
    pending,
    mustReview,
    disabled:
      pending || !retry || mustReview || !context.online || !context.active,
    message: mustReview
      ? 'This change may have reached the server. Check the latest state before trying again.'
      : !failure
        ? undefined
        : error instanceof ApiError &&
            (error.status === 403 || error.status === 404)
          ? 'This action is unavailable. Check the latest Workspace access.'
          : workspaceErrorMessage(error),
    clearError: () => setFailure(undefined),
    reviewed() {
      setMustReview(false);
      setFailure(undefined);
    },
  };
}
