import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RegisterRequestDto } from '../../src/api/auth/dto/register-request.dto';
import { LoginRequestDto } from '../../src/api/auth/dto/login-request.dto';

const input = { email: 'ada@example.test', displayName: 'Ada Lovelace' };

describe('registration password policy', () => {
  it.each([
    '12345678',
    'Abcdefg1',
    'Abcdefg!',
    'abcdef1!',
    'Ab1!xyz',
    'ABC1234 ',
    'ABC1234\t',
    'ABC1234\n',
    'ABC1234\u00a0',
    'Ébcdef1!',
    'ABCdef١!',
    `A1!${'x'.repeat(126)}`,
    `A1!${'😀'.repeat(126)}`,
    'AB1❤️abc',
    '',
    null,
    undefined,
    12345678,
    ['ABC1234!'],
  ])('rejects invalid registration password %p', (password) => {
    const dto = plainToInstance(RegisterRequestDto, { ...input, password });
    expect(validateSync(dto).map((error) => error.property)).toEqual([
      'password',
    ]);
  });

  it.each([
    'ABC1234!',
    'Kanvexa@2026',
    ' ABC1234! ',
    'ABC1 abc!',
    'ABC1\nabc!',
    'ABC1234—',
    'ABC1234😀',
    'AB1❤️abcd',
    `A1!${'x'.repeat(125)}`,
    `A1!${'😀'.repeat(125)}`,
    '  ABC1234! e\u0301  ',
  ])('accepts without altering registration password %p', (password) => {
    const dto = plainToInstance(RegisterRequestDto, { ...input, password });
    expect(validateSync(dto)).toEqual([]);
    expect(dto.password).toBe(password);
  });

  it('keeps weak existing credentials valid for LoginRequestDto', () => {
    const dto = plainToInstance(LoginRequestDto, {
      email: input.email,
      password: '12345678',
    });
    expect(validateSync(dto)).toEqual([]);
  });
});
