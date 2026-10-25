import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ErrorCode } from '../../common/dto/api-error';
import { toResponseDto } from '../../common/dto/to-response-dto';
import { ApplicationException } from '../../exceptions/application.exception';
import { UpdateUserPreferencesDto } from './dto/update-user-preferences.dto';
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

  async update(
    userId: string,
    input: UpdateUserPreferencesDto,
  ): Promise<UserPreferencesResponseDto> {
    if (Object.values(input).every((value) => value === undefined)) {
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'Validation failed',
        ['At least one preference field must be provided'],
      );
    }
    return this.preferences.manager.transaction(async (manager) => {
      // Lock the parent even before the first preferences row exists.
      const user = await manager.getRepository(User).findOne({
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw this.userNotFound();
      const repository = manager.getRepository(UserPreferences);
      const stored = await repository.findOneBy({ userId });
      const preferences =
        stored ?? repository.create({ userId, ...DEFAULT_USER_PREFERENCES });
      if (input.theme !== undefined) preferences.theme = input.theme;
      if (input.timeZone !== undefined) preferences.timeZone = input.timeZone;
      if (input.dateFormat !== undefined)
        preferences.dateFormat = input.dateFormat;
      if (input.weekStartsOn !== undefined)
        preferences.weekStartsOn = input.weekStartsOn;
      return toResponseDto(
        UserPreferencesResponseDto,
        await repository.save(preferences),
      );
    });
  }

  private userNotFound(): ApplicationException {
    return new ApplicationException(
      HttpStatus.NOT_FOUND,
      ErrorCode.NOT_FOUND,
      'User not found',
    );
  }
}
