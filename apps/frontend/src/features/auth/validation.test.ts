import { describe, expect, it } from 'vitest';
import {
  newPasswordRequirements,
  passwordLength,
  validateNewPassword,
} from './validation';

describe('registration password validation', () => {
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
  ])('rejects %p', (password) => {
    expect(validateNewPassword(password)).toBeTruthy();
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
  ])(
    'accepts %p without requiring lowercase or banning whitespace',
    (password) => {
      expect(validateNewPassword(password)).toBeUndefined();
      expect(newPasswordRequirements(password).every((rule) => rule.met)).toBe(
        true,
      );
    },
  );

  it('counts emoji and presentation sequences as the backend does', () => {
    expect(passwordLength('AB1❤️abcd')).toBe(8);
    expect(passwordLength(`A1!${'😀'.repeat(125)}`)).toBe(128);
    expect(passwordLength(`A1!${'😀'.repeat(126)}`)).toBe(129);
  });
});
