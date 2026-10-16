import { describe, expect, it } from 'vitest';
import {
  dueDateFromInput,
  dueDateToInput,
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

describe('due dates', () => {
  it('saves a picked day as the end of that local day, with a timezone', () => {
    const iso = dueDateFromInput('2026-10-25')!;
    expect(iso).toMatch(/Z$/);
    const local = new Date(iso);
    expect([local.getFullYear(), local.getMonth(), local.getDate()]).toEqual([
      2026, 9, 25,
    ]);
    expect([local.getHours(), local.getMinutes()]).toEqual([23, 59]);
  });

  it('treats a blank or invalid value as no due date', () => {
    expect(dueDateFromInput('')).toBeNull();
    expect(dueDateFromInput('25/10/2026')).toBeNull();
  });

  it('shows a stored due date as its local day and round-trips', () => {
    expect(dueDateToInput(null)).toBe('');
    expect(dueDateToInput(dueDateFromInput('2026-01-01'))).toBe('2026-01-01');
    expect(dueDateToInput(dueDateFromInput('2026-12-31'))).toBe('2026-12-31');
  });
});
