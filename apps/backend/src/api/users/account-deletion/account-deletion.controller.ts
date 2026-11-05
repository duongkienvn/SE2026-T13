import {
  Body,
  Controller,
  Delete,
  Header,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiResponse } from '@nestjs/swagger';
import {
  ApiBearerToken,
  ApiCommonErrors,
  ApiNoContent,
} from '../../../decorators/swagger-response.decorators';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PasswordChangeThrottlerGuard } from '../../auth/guards/password-change-throttler.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/constants/auth.constants';
import { DeleteAccountDto } from './delete-account.dto';
import { AccountDeletionReauthenticationService } from './account-deletion-reauthentication.service';
import { AccountDeletionService } from './account-deletion.service';

@Controller('users/me')
@UseGuards(JwtAuthGuard, PasswordChangeThrottlerGuard)
export class AccountDeletionController {
  constructor(
    private readonly reauthentication: AccountDeletionReauthenticationService,
    private readonly deletion: AccountDeletionService,
  ) {}

  @Delete()
  @HttpCode(204)
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @ApiBearerToken()
  @ApiNoContent({
    summary: 'Irreversibly erase account identity and revoke sessions',
    description:
      'Exact DELETE confirmation and exactly one current password or fresh linked Google credential. Shared content retains Deleted user attribution. After 204 purge protected caches and sign out; no replacement JWT.',
  })
  @ApiCommonErrors([400, 401, 403, 429, 500, 503])
  @ApiResponse({
    status: 409,
    description:
      'ACCOUNT_DELETION_BLOCKED: blockers contain type, totalCount and up to 20 resources {id,name}. CONFLICT: retry concurrent changes.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        statusCode: { type: 'integer', example: 409 },
        code: { type: 'string', example: 'ACCOUNT_DELETION_BLOCKED' },
        message: { type: 'string' },
        timestamp: { type: 'string', format: 'date-time' },
        path: { type: 'string' },
        blockers: {
          type: 'array',
          items: {
            type: 'object',
            required: ['type', 'totalCount', 'resources'],
            properties: {
              type: {
                type: 'string',
                enum: [
                  'PERSONAL_WORKSPACE_HAS_BOARDS',
                  'BOARD_REQUIRES_ANOTHER_OWNER',
                  'TEAM_WORKSPACE_REQUIRES_ANOTHER_ADMIN',
                ],
              },
              totalCount: { type: 'integer', minimum: 1 },
              resources: {
                type: 'array',
                maxItems: 20,
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    name: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  async delete(
    @CurrentUser() identity: AuthenticatedUser,
    @Body() input: DeleteAccountDto,
  ): Promise<void> {
    const proof = await this.reauthentication.verify(identity, input);
    await this.deletion.delete(proof);
  }
}
