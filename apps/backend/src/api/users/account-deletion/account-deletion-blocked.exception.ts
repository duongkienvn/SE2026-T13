import type { AccountDeletionBlocker } from '@kanban/shared';
import { ApplicationException } from '../../../exceptions/application.exception';

export class AccountDeletionBlockedException extends ApplicationException {
  constructor(readonly blockers: AccountDeletionBlocker[]) {
    super(
      409,
      'ACCOUNT_DELETION_BLOCKED',
      'Resolve ownership requirements before deleting your account',
    );
  }
}
