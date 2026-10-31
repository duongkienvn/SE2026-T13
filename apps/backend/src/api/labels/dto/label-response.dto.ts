import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { toResponseDto } from '../../../common/dto/to-response-dto';
import { BoardLabel } from '../entities/board-label.entity';

export class LabelResponseDto {
  @Expose() @ApiProperty({ format: 'uuid' }) id!: string;
  @Expose() @ApiProperty({ format: 'uuid' }) boardId!: string;
  @Expose() @ApiProperty({ minLength: 1, maxLength: 120 }) name!: string;
  @Expose()
  @ApiProperty({ pattern: '^#[0-9A-F]{6}$', example: '#615CF7' })
  color!: string;
  @Expose() @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @Expose() @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
export function toLabelResponse(label: BoardLabel): LabelResponseDto {
  return toResponseDto(LabelResponseDto, {
    id: label.id,
    boardId: label.boardId,
    name: label.name,
    color: label.color,
    createdAt: label.createdAt.toISOString(),
    updatedAt: label.updatedAt.toISOString(),
  });
}
