import {
  Body,
  Controller,
  Delete,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import { StringField } from '../../decorators/field.decorators';
import {
  ApiBearerToken,
  ApiCommonErrors,
  ApiNoContent,
} from '../../decorators/swagger-response.decorators';
import { WorkspaceDeletionService } from './workspace-deletion.service';

class DeleteWorkspaceDto {
  @StringField({ maxLength: 120 }) confirmationName!: string;
}

@ApiTags('workspaces')
@UseGuards(JwtAuthGuard)
@Controller('workspaces')
export class WorkspaceDeletionController {
  constructor(private readonly deletion: WorkspaceDeletionService) {}

  @Delete(':workspaceId')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiBearerToken()
  @ApiCommonErrors()
  @ApiNoContent({ summary: 'Delete an empty Team Workspace as ADMIN' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId', ParseUUIDPipe) id: string,
    @Body() input: DeleteWorkspaceDto,
  ) {
    return this.deletion.remove(user.userId, id, input.confirmationName);
  }
}
