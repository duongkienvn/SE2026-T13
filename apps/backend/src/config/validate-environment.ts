import { validateEnvironment } from './environment';

// Validation only: do not import bootstrap, database, workers or provider clients.
try {
  validateEnvironment(process.env);
} catch {
  // Never print the input, exception or stack; configuration can contain secrets.
  console.error('Backend environment validation failed. Check configuration.');
  process.exitCode = 1;
}
