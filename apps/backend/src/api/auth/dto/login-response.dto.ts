import { Expose, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '../../users/dto/user-response.dto';

export class LoginResponseDto {
  @Expose()
  @ApiProperty()
  accessToken!: string;

  @Expose()
  @ApiProperty({ example: 'Bearer' })
  tokenType!: 'Bearer';

  @Expose()
  @ApiProperty({ example: 3600 })
  expiresIn!: number;

  @Expose()
  @Type(() => UserResponseDto)
  @ApiProperty({ type: UserResponseDto })
  user!: UserResponseDto;
}
