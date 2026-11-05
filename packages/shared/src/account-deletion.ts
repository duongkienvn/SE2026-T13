/** Authenticated-only account closure contract. Resource lists are capped at 20. */
export type AccountDeletionBlockerType =
  | 'PERSONAL_WORKSPACE_HAS_BOARDS'
  | 'BOARD_REQUIRES_ANOTHER_OWNER'
  | 'TEAM_WORKSPACE_REQUIRES_ANOTHER_ADMIN';

export interface AccountDeletionBlocker {
  type: AccountDeletionBlockerType;
  totalCount: number;
  resources: { id: string; name: string }[];
}

export type DeleteAccountRequest = { confirmation: 'DELETE' } & (
  | { currentPassword: string; googleCredential?: never }
  | { googleCredential: string; currentPassword?: never }
);
