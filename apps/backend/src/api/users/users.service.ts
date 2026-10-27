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
    if (input.displayName === undefined) {
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'Validation failed',
        ['At least one profile field must be provided'],
      );
    }
    await this.findUser(userId);
    // Never save a stale full User: concurrent credential changes must survive
    // profile edits that started before the password/auth-version transaction.
    const patch: Partial<Pick<User, 'displayName'>> = {};
    if (input.displayName !== undefined) patch.displayName = input.displayName;
    await this.users.update(userId, patch);
    return toUserResponseDto(await this.findUser(userId));
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
