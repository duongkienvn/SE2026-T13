import { PageHeader } from '../../../components/PageHeader';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { AccountExportCard } from './AccountExportCard';
import { BoardExportCard } from './BoardExportCard';
import { AccountDangerZone } from './DangerZone';
import { InfoStrip } from './ExportCard';

/**
 * Settings → Data & Privacy. The export sections (#224) are self-contained;
 * the P5-08 Danger Zone (#225) is appended after `PrivacyNotice` as its own
 * section, without changing the export cards.
 */
export function DataPrivacyPage() {
  usePageTitle('Data & Privacy');
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Data & Privacy"
        description="Manage your data, export a copy, and control your account privacy."
      />
      <div className="mt-4 space-y-3">
        <AccountExportCard />
        <BoardExportCard />
        <PrivacyNotice />
        <AccountDangerZone />
      </div>
    </div>
  );
}

function PrivacyNotice() {
  return (
    <InfoStrip className="bg-surface">
      Exports contain only data you can access and may include personal data.
      Large boards take longer.
    </InfoStrip>
  );
}
