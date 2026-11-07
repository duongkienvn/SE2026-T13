import { PageHeader } from '../../../components/PageHeader';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { useAuthSession } from '../../auth/auth-session-context';
import { AccountSecurity } from '../../auth/components/AccountSecurity';
import { ChangeEmailCard } from '../security/ChangeEmailCard';

export function SecuritySettingsPage() {
  usePageTitle('Security');
  const { generation } = useAuthSession();
  return (
    <>
      <PageHeader
        title="Security"
        description="Manage your account security."
      />
      <AccountSecurity />
      {/* A new session never inherits another session's half-filled form. */}
      <ChangeEmailCard key={generation} />
    </>
  );
}
