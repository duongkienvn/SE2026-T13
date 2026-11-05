import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

/** No live profile target, email or private avatar. Existing author/actor FK stays separate. */
export class DeletedUserAttributionDto {
  @Expose()
  @ApiProperty({ enum: ['Deleted user'] })
  displayName = 'Deleted user' as const;
  @Expose() @ApiProperty({ enum: [true] }) isDeleted = true as const;
}
