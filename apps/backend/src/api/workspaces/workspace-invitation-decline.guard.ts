import { Injectable } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

/** Decline's explicit verification error, without changing existing route behavior. */
@Injectable()
export class WorkspaceInvitationDeclineGuard extends JwtAuthGuard {
  protected override readonly unverifiedStatus = 403;
  constructor(auth: AuthService) {
    super(auth);
  }
}
