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
import { WorkspacesService } from '../workspaces/workspaces.service';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$FkCAAQOfeN/lp3mMq1O8aw$LWh98eRvcVRX1VCWEcG9asSUZIBwaYSxzn6jPGgxQ9I';

function isEmailUniqueViolation(error: QueryFailedError): boolean {
  const driverError = error.driverError;
  return (
    typeof driverError === 'object' &&
    driverError !== null &&
    'code' in driverError &&
    driverError.code === '23505' &&
    'constraint' in driverError &&
    driverError.constraint === 'UQ_users_email'
  );
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    private readonly verification: EmailVerificationService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async register(input: RegisterRequestDto): Promise<UserResponseDto> {
    const existing = await this.users.findOne({
      where: { email: input.email },
    });
    if (existing) throw this.emailAlreadyExists();

    // Hash before opening the transaction; no row lock spans this CPU work.
    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
    });
    let saved: User;
    try {
      saved = await this.users.manager.transaction(async (manager) => {
        const users = manager.getRepository(User);
        const user = await users.save(
          users.create({
            email: input.email,
            passwordHash,
            displayName: input.displayName,
            avatarUrl: null,
            emailVerifiedAt: null,
          }),
        );
        await this.workspaces.ensurePersonalWorkspace(user.id, manager);
        return user;
      });
    } catch (error) {
      if (error instanceof QueryFailedError && isEmailUniqueViolation(error)) {
        throw this.emailAlreadyExists();
      }
      throw error;
    }
    // Delivery failure retains the committed pending account + Workspace for resend.
    await this.verification.send(saved.email, true);
    return toUserResponseDto(saved);
  }

  async login(input: LoginRequestDto): Promise<LoginResponseDto> {
    const user = await this.users.findOne({ where: { email: input.email } });
    const passwordHash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const validPassword = await argon2.verify(passwordHash, input.password);
    if (!user?.passwordHash || !validPassword) throw this.invalidCredentials();
    if (!user.emailVerifiedAt) {
      throw new ApplicationException(
        HttpStatus.FORBIDDEN,
        ErrorCode.EMAIL_NOT_VERIFIED,
        'Verify your email address before logging in.',
      );
    }

    return this.issueLoginResponse(user);
  }

  async issueLoginResponse(user: User): Promise<LoginResponseDto> {
    if (!user.emailVerifiedAt) {
      throw new ApplicationException(
        HttpStatus.FORBIDDEN,
        ErrorCode.EMAIL_NOT_VERIFIED,
        'Verify your email address before logging in.',
      );
    }
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      authVersion: user.authVersion,
    });
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: JWT_EXPIRES_IN_SECONDS,
      user: toUserResponseDto(user),
    };
  }

  async reauthenticate(userId: string, password: string): Promise<User> {
    const user = await this.users.findOne({ where: { id: userId } });
    const valid = await argon2.verify(
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
      password,
    );
    if (!user?.passwordHash || !user.emailVerifiedAt || !valid)
      throw this.invalidCredentials();
    return user;
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
      (claims.authVersion !== undefined &&
        (!Number.isSafeInteger(claims.authVersion) ||
          claims.authVersion < 0)) ||
      !Number.isSafeInteger(claims.exp) ||
      claims.exp * 1000 <= Date.now() ||
      !Number.isSafeInteger(claims.exp * 1000)
    ) {
      throw this.unauthorized();
    }
    const user = await this.users.findOne({ where: { id: claims.sub } });
    if (
      !user?.emailVerifiedAt ||
      (claims.authVersion ?? 0) !== user.authVersion
    )
      throw this.unauthorized();
    return {
      userId: user.id,
      authVersion: user.authVersion,
      expiresAt: claims.exp * 1000,
    };
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
