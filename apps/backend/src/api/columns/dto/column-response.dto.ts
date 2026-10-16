import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { toResponseDto } from '../../../common/dto/to-response-dto';
import { BoardColumn } from '../entities/board-column.entity';

export class ColumnResponseDto {
  @Expose()
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @Expose()
  @ApiProperty({ format: 'uuid' })
  boardId!: string;

  @Expose()
  @ApiProperty({ minLength: 1, maxLength: 120 })
  name!: string;

  @Expose()
  @ApiProperty({ type: String, example: '100.0000000000' })
  position!: string;

  @Expose()
  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @Expose()
  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export function toColumnResponseDto(column: BoardColumn): ColumnResponseDto {
  return toResponseDto(ColumnResponseDto, {
    id: column.id,
    boardId: column.boardId,
    name: column.name,
    position: column.position,
    createdAt: column.createdAt.toISOString(),
    updatedAt: column.updatedAt.toISOString(),
  });
}
