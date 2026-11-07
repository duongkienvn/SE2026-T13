import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppProviders } from './app/AppProviders';
import './style.css';
import { captureVerificationLink } from './features/auth/verification-link';
import { captureRecoveryLink } from './features/auth/recovery-link';
import { captureEmailChangeLink } from './features/auth/email-change-link';

captureVerificationLink();
captureRecoveryLink();
captureEmailChangeLink();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
);
