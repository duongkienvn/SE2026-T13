import { describe, expect, it } from 'vitest';
import {
  normalizeCardDescription,
  validateCardDescription,
  validateCardTitle,
} from './validation';

describe('card validation', () => {
  it('requires a trimmed title of at most 120 characters', () => {
    expect(validateCardTitle('   ')).toBe('Enter a card title.');
    expect(validateCardTitle(` ${'a'.repeat(120)} `)).toBeUndefined();
    expect(validateCardTitle('a'.repeat(121))).toBe(
      'Title must be at most 120 characters.',
    );
  });

  it('limits descriptions to 2000 characters and sends blanks as null', () => {
    expect(validateCardDescription('a'.repeat(2000))).toBeUndefined();
    expect(validateCardDescription('a'.repeat(2001))).toBe(
      'Description must be at most 2000 characters.',
    );
    expect(normalizeCardDescription('  \n ')).toBeNull();
    expect(normalizeCardDescription('  Notes  ')).toBe('Notes');
  });
});
