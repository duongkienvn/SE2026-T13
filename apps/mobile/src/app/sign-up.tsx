import { SignUpScreen } from '../features/auth/SignUpScreen';
import { PublicAuthGate } from '../features/auth/runtime';
export default function AuthRoute() {
  return (
    <PublicAuthGate>
      <SignUpScreen />
    </PublicAuthGate>
  );
}
