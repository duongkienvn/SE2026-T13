import { Module } from '@nestjs/common';
import { StarterBoardProvisioningService } from './starter-board-provisioning.service';

/** No Auth/Boards module import: avoids cycles and exposes no public endpoint. */
@Module({
  providers: [StarterBoardProvisioningService],
  exports: [StarterBoardProvisioningService],
})
export class StarterBoardProvisioningModule {}
