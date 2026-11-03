import { Injectable } from '@nestjs/common';
import { NotificationKind } from '@kanban/shared';
import type { EntityManager } from 'typeorm';
import type { UserNotification } from './entities/user-notification.entity';

export type InvitationNotificationKind =
  | typeof NotificationKind.WORKSPACE_INVITED
  | typeof NotificationKind.BOARD_INVITED;
export interface VerifiedNotificationInvitation {
  /** Current name, read only AFTER ownership/email binding, pending state and expiry validation. */
  name: string;
  workspaceId: string | null;
  boardId: string | null;
  /** Opt in only if current invitation binding permits the inviter's public identity. */
  actorVisible?: boolean;
  /** Only the originating module may supply a CURRENT verified proof, never a saved snapshot. */
  destination?:
    | { kind: 'workspaceInvitation'; proof: string }
    | { kind: 'board'; boardId: string };
}
export type NotificationInvitationResolver = (
  manager: EntityManager,
  recipientUserId: string,
  notifications: readonly Readonly<UserNotification>[],
) => Promise<ReadonlyMap<string, VerifiedNotificationInvitation>>;

/** P4-04 registers source-specific, batched verifiers. No verifier => unavailable.
 * This registry stores functions only, never cached proofs, names or resolutions.
 */
@Injectable()
export class NotificationInvitationResolvers {
  private readonly resolvers = new Map<
    InvitationNotificationKind,
    NotificationInvitationResolver
  >();
  register(
    kind: InvitationNotificationKind,
    resolver: NotificationInvitationResolver,
  ): () => void {
    if (
      ![
        NotificationKind.WORKSPACE_INVITED,
        NotificationKind.BOARD_INVITED,
      ].includes(kind) ||
      this.resolvers.has(kind)
    )
      throw new Error('Invalid or duplicate invitation notification resolver');
    this.resolvers.set(kind, resolver);
    return () => {
      if (this.resolvers.get(kind) === resolver) this.resolvers.delete(kind);
    };
  }
  async resolve(
    manager: EntityManager,
    recipient: string,
    rows: readonly UserNotification[],
  ): Promise<Map<string, VerifiedNotificationInvitation>> {
    const result = new Map<string, VerifiedNotificationInvitation>();
    for (const kind of [
      NotificationKind.WORKSPACE_INVITED,
      NotificationKind.BOARD_INVITED,
    ] as const) {
      const resolver = this.resolvers.get(kind),
        matching = rows.filter((row) => row.kind === kind);
      if (!resolver || !matching.length) continue;
      try {
        const verified = await resolver(manager, recipient, matching);
        for (const row of matching) {
          const value = verified.get(row.id);
          if (value) result.set(row.id, value);
        }
      } catch {
        // Fail closed without exposing source module errors, names or proofs.
      }
    }
    return result;
  }
}
