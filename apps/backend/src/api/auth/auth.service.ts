import { Injectable, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import {
  UserResponseDto,
  toUserResponseDto,
} from '../users/dto/user-response.dto';
import { ApplicationException } from '../../exceptions/application.exception';
import { ErrorCode } from '../../common/dto/api-error';
import {
  AuthenticatedUser,
  JWT_EXPIRES_IN_SECONDS,
  JwtClaims,
} from './constants/auth.constants';
import { LoginRequestDto } from './dto/login-request.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { RegisterRequestDto } from './dto/register-request.dto';
import { EmailVerificationService } from './email-verification.service';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$FkCAAQOfeN/lp3mMq1O8aw$LWh98eRvcVRX1VCWEcG9asSUZIBwaYSxzn6jPGgxQ9I';

function isUniqueViolation(error: QueryFailedError): boolean {
  const driverError = error.driverError;
  return (
    typeof driverError === 'object' &&
    driverError !== null &&
    'code' in driverError &&
    driverError.code === '23505'
  );
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    private readonly verification: EmailVerificationService,
  ) {}

  async register(input: RegisterRequestDto): Promise<UserResponseDto> {
    const existing = await this.users.findOne({
      where: { email: input.email },
    });
    if (existing) throw this.emailAlreadyExists();

    try {
      const user = this.users.create({
        email: input.email,
        passwordHash: await argon2.hash(input.password, {
          type: argon2.argon2id,
        }),
        displayName: input.displayName,
        avatarUrl: null,
        emailVerifiedAt: null,
      });
      const saved = await this.users.save(user);
      await this.verification.send(saved.email, true);
      return toUserResponseDto(saved);
    } catch (error) {
      if (error instanceof QueryFailedError && isUniqueViolation(error)) {
        throw this.emailAlreadyExists();
      }
      throw error;
    }
  }

  async login(input: LoginRequestDto): Promise<LoginResponseDto> {
    const user = await this.users.findOne({ where: { email: input.email } });
    const passwordHash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const validPassword = await argon2.verify(passwordHash, input.password);
    if (!user || !validPassword) throw this.invalidCredentials();
    if (!user.emailVerifiedAt) {
      throw new ApplicationException(
        HttpStatus.FORBIDDEN,
        ErrorCode.EMAIL_NOT_VERIFIED,
        'Verify your email address before logging in.',
      );
    }

    const accessToken = await this.jwt.signAsync({ sub: user.id });
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: JWT_EXPIRES_IN_SECONDS,
      user: toUserResponseDto(user),
    };
  }

  async authenticateAccessToken(token: string): Promise<AuthenticatedUser> {
    let claims: JwtClaims;
    try {
      claims = await this.jwt.verifyAsync<JwtClaims>(token);
    } catch (error) {
      if (error instanceof Error) throw this.unauthorized();
      throw error;
    }
    if (
      !UUID_PATTERN.test(claims.sub) ||
      !Number.isSafeInteger(claims.exp) ||
      claims.exp * 1000 <= Date.now() ||
      !Number.isSafeInteger(claims.exp * 1000)
    ) {
      throw this.unauthorized();
    }
    const user = await this.users.findOne({ where: { id: claims.sub } });
    if (!user?.emailVerifiedAt) throw this.unauthorized();
    return { userId: user.id, expiresAt: claims.exp * 1000 };
  }

  private emailAlreadyExists(): ApplicationException {
    return new ApplicationException(
      HttpStatus.CONFLICT,
      ErrorCode.EMAIL_ALREADY_EXISTS,
      'Email already exists',
    );
  }

  private invalidCredentials(): ApplicationException {
    return new ApplicationException(
      HttpStatus.UNAUTHORIZED,
      ErrorCode.INVALID_CREDENTIALS,
      'Invalid email or password',
    );
  }

  private unauthorized(): ApplicationException {
    return new ApplicationException(
      HttpStatus.UNAUTHORIZED,
      ErrorCode.UNAUTHORIZED,
      'Unauthorized',
    );
  }
}
