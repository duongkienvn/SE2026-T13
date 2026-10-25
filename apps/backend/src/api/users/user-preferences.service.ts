import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ErrorCode } from '../../common/dto/api-error';
import { toResponseDto } from '../../common/dto/to-response-dto';
import { ApplicationException } from '../../exceptions/application.exception';
import { UserPreferencesResponseDto } from './dto/user-preferences-response.dto';
import { UserPreferences } from './entities/user-preferences.entity';
import { User } from './entities/user.entity';
import { DEFAULT_USER_PREFERENCES } from './user-preferences.constants';

@Injectable()
export class UserPreferencesService {
  constructor(
    @InjectRepository(UserPreferences)
    private readonly preferences: Repository<UserPreferences>,
  ) {}

  async get(userId: string): Promise<UserPreferencesResponseDto> {
    const user = await this.preferences.manager
      .getRepository(User)
      .existsBy({ id: userId });
    if (!user) throw this.userNotFound();
    const stored = await this.preferences.findOneBy({ userId });
    return toResponseDto(
      UserPreferencesResponseDto,
      stored ?? DEFAULT_USER_PREFERENCES,
    );
  }

  private userNotFound(): ApplicationException {
    return new ApplicationException(
      HttpStatus.NOT_FOUND,
      ErrorCode.NOT_FOUND,
      'User not found',
    );
  }
}
