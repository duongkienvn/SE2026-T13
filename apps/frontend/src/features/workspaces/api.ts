import type {
  CreateTeamWorkspaceInput,
  WorkspaceOverview,
  WorkspaceSummary,
} from './types';

/**
 * Frontend integration seam. P2-02 must implement an adapter using the verified
 * wire DTOs and the existing apiRequest envelope. No speculative URLs are called.
 * list must contain Workspace memberships only; overview must apply Board ACLs
 * before counting/limiting. Board membership never implies Workspace membership.
 */
export interface WorkspaceGateway {
  available: boolean;
  list(token: string, signal: AbortSignal): Promise<WorkspaceSummary[]>;
  overview(
    token: string,
    workspaceId: string,
    signal: AbortSignal,
  ): Promise<WorkspaceOverview>;
  createTeam(
    token: string,
    input: CreateTeamWorkspaceInput,
  ): Promise<WorkspaceSummary>;
}

export class WorkspaceUnavailableError extends Error {
  constructor() {
    super('Workspace services are not available yet.');
    this.name = 'WorkspaceUnavailableError';
  }
}

const unavailable = () => Promise.reject(new WorkspaceUnavailableError());

/** No fallback data, HTTP probing or guessed backend contract in production. */
export const workspaceGateway: WorkspaceGateway = {
  available: false,
  list: unavailable,
  overview: unavailable,
  createTeam: unavailable,
};
