import { PageHeader } from '../../../components/PageHeader';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { ConnectedAccounts } from '../../auth/components/ConnectedAccounts';

export function ConnectedAccountsPage() {
  usePageTitle('Connected accounts');
  return (
    <>
      <PageHeader
        title="Connected Accounts"
        description="Sign-in methods linked to your Kanvexa account."
      />
      <ConnectedAccounts />
    </>
  );
}
