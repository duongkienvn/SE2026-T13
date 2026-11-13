import { VerifyEmailScreen } from '../features/auth/VerifyEmailScreen';
import { PublicAuthGate } from '../features/auth/runtime';
export default function AuthRoute() {
  return (
    <PublicAuthGate>
      <VerifyEmailScreen />
    </PublicAuthGate>
  );
}
