import { PageHeader } from '../../../components/PageHeader';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { AccountSecurity } from '../../auth/components/AccountSecurity';

export function SecuritySettingsPage() {
  usePageTitle('Security');
  return (
    <>
      <PageHeader
        title="Security"
        description="Manage your account security."
      />
      <AccountSecurity />
    </>
  );
}
