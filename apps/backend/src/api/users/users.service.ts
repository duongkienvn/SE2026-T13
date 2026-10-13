import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ErrorCode } from '../../common/dto/api-error';
import { ApplicationException } from '../../exceptions/application.exception';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { UserResponseDto, toUserResponseDto } from './dto/user-response.dto';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async getCurrentUser(userId: string): Promise<UserResponseDto> {
    return toUserResponseDto(await this.findUser(userId));
  }

  async updateCurrentUser(
    userId: string,
    input: UpdateUserProfileDto,
  ): Promise<UserResponseDto> {
    if (input.displayName === undefined && input.avatarUrl === undefined) {
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'Validation failed',
        ['At least one profile field must be provided'],
      );
    }
    const user = await this.findUser(userId);
    if (input.displayName !== undefined) user.displayName = input.displayName;
    if (input.avatarUrl !== undefined) user.avatarUrl = input.avatarUrl;
    return toUserResponseDto(await this.users.save(user));
  }

  private async findUser(userId: string): Promise<User> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new ApplicationException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'User not found',
      );
    }
    return user;
  }
}
