/** Transport-free port: persistence/domain modules never import Auth or a gateway. */
export abstract class NotificationInvalidation {
  /** Call only after the caller-owned transaction resolves successfully. */
  abstract afterCommit(recipientUserIds: readonly string[]): Promise<void>;
}
