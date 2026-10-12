import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ example: 'Realtime Collaborative Kanban' })
  name!: string;

  @ApiProperty({ example: 'ok' })
  status!: string;
}

export class ReadinessResponseDto {
  @ApiProperty({ example: 'ok' })
  status!: 'ok';

  @ApiProperty({ example: 'ok' })
  database!: 'ok';
}
