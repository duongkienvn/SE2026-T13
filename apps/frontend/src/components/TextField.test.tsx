import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TextField } from './TextField';

describe('TextField descriptions', () => {
  it('keeps external requirements and the current hint/error connected to the input', () => {
    const { rerender } = render(
      <>
        <p id="rules">Requirements</p>
        <TextField label="Password" aria-describedby="rules" hint="Hint" />
      </>,
    );
    const descriptions = () =>
      screen
        .getByLabelText('Password')
        .getAttribute('aria-describedby')!
        .split(' ')
        .map((id) => document.getElementById(id)?.textContent);
    expect(descriptions()).toEqual(['Requirements', 'Hint']);
    rerender(
      <>
        <p id="rules">Requirements</p>
        <TextField
          label="Password"
          aria-describedby="rules"
          hint="Hint"
          error="Invalid password"
        />
      </>,
    );
    expect(descriptions()).toEqual(['Requirements', 'Invalid password']);
    expect(screen.queryByText('Hint')).toBeNull();
    expect(screen.getByLabelText('Password').getAttribute('aria-invalid')).toBe(
      'true',
    );
  });
});
