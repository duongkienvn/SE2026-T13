import { expect, it } from 'vitest';
import {
  captureVerificationLink,
  clearIncomingVerificationToken,
  readIncomingVerificationToken,
} from './verification-link';

it('captures the initial token only in memory and replaces browser history before mounting', () => {
  const synthetic = 'x'.repeat(43);
  const previous = window.location.href;
  try {
    window.history.replaceState(
      {},
      '',
      `/verify-email?token=${synthetic}#fragment`,
    );
    captureVerificationLink();
    expect(window.location.pathname).toBe('/verify-email');
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
    expect(readIncomingVerificationToken()).toBe(synthetic);
    clearIncomingVerificationToken();
    expect(readIncomingVerificationToken()).toBeNull();
  } finally {
    clearIncomingVerificationToken();
    window.history.replaceState({}, '', previous);
  }
});
