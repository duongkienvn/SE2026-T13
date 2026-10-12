import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ example: 'Realtime Collaborative Kanban' })
  name!: string;

  @ApiProperty({ example: 'ok' })
  status!: string;
}
