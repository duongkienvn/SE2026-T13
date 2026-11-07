import { PageHeader } from '../../../components/PageHeader';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { AccountExportCard } from './AccountExportCard';
import { BoardExportCard } from './BoardExportCard';
import { InfoStrip } from './ExportCard';

/**
 * Settings → Data & Privacy (#224). The export sections are self-contained;
 * account controls (P5-08 Danger Zone) are appended after `PrivacyNotice`
 * as their own section, without changing the export cards.
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
