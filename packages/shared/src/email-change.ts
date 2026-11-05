export type EmailChangeRequest = { newEmail: string } & (
  | { currentPassword: string; googleCredential?: never }
  | { googleCredential: string; currentPassword?: never }
);
export interface PendingEmailChangeSummary {
  maskedNewEmail: string;
  issuedAt: string;
  expiresAt: string;
}
export interface ConfirmEmailChangeRequest {
  token: string;
}
