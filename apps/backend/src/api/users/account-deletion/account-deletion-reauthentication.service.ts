import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/constants/auth.constants';
import {
  EmailChangeReauthenticationService,
  type EmailChangeProof,
  invalidReauthentication,
} from '../../auth/email-change-reauthentication.service';
import { ApplicationException } from '../../../exceptions/application.exception';
import { ErrorCode } from '../../../common/dto/api-error';
import { DeleteAccountDto } from './delete-account.dto';

/** Reuse signature/issuer/audience/five-minute freshness and linked-subject checks. */
@Injectable()
export class AccountDeletionReauthenticationService {
  constructor(private readonly proofs: EmailChangeReauthenticationService) {}

  async verify(
    identity: AuthenticatedUser,
    input: DeleteAccountDto,
  ): Promise<EmailChangeProof> {
    if (input.confirmation !== 'DELETE')
      throw new ApplicationException(
        400,
        ErrorCode.VALIDATION_FAILED,
        'Validation failed',
      );
    if (
      input.currentPassword === undefined &&
      input.googleCredential === undefined
    )
      throw invalidReauthentication();
    return this.proofs.verify(identity, input);
  }
}
