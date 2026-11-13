import { ForgotPasswordScreen } from '../features/auth/RecoveryScreens';
import { PublicAuthGate } from '../features/auth/runtime';
export default function AuthRoute() {
  return (
    <PublicAuthGate>
      <ForgotPasswordScreen />
    </PublicAuthGate>
  );
}
