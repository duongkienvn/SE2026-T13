/** Workspace roles are independent of BoardRole and never imply Board access. */
export const WorkspaceType = { PERSONAL: 'PERSONAL', TEAM: 'TEAM' } as const;
export type WorkspaceType = (typeof WorkspaceType)[keyof typeof WorkspaceType];

export const WorkspaceRole = { ADMIN: 'ADMIN', MEMBER: 'MEMBER' } as const;
export type WorkspaceRole = (typeof WorkspaceRole)[keyof typeof WorkspaceRole];

/** WORKSPACE_VISIBLE is persistence-only until the access policy is delivered. */
export const BoardVisibility = {
  PRIVATE: 'PRIVATE',
  WORKSPACE_VISIBLE: 'WORKSPACE_VISIBLE',
} as const;
export type BoardVisibility =
  (typeof BoardVisibility)[keyof typeof BoardVisibility];

/** Domain identity only; public response DTOs are defined by the owning API. */
export interface WorkspaceIdentity {
  id: string;
  type: WorkspaceType;
  /** Immutable creator; also the durable owner of a PERSONAL workspace. */
  createdById: string;
}

export interface WorkspaceMembershipIdentity {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}
