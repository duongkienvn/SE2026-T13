import { UserIcon } from '../../../components/icons';
import { exportAccountData } from './export-api';
import { ExportAction, ExportCard, InfoStrip } from './ExportCard';
import { useExportDownload } from './useExportDownload';

/** JSON metadata of the signed-in account (#216); no format choice, no confirm. */
export function AccountExportCard() {
  const download = useExportDownload();
  return (
    <ExportCard
      id="account-export"
      title="Export account data"
      description="Your profile, settings, sign-in methods, memberships, notifications and comments."
      icon={UserIcon}
    >
      <ExportAction
        label="Export my data"
        state={download.state}
        beside={
          <InfoStrip className="lg:flex-1">
            JSON format. Board contents and uploaded files are not included.
          </InfoStrip>
        }
        onClick={() =>
          void download.start({
            target: { kind: 'account' },
            request: (token, signal) => exportAccountData(token, signal),
          })
        }
      />
    </ExportCard>
  );
}
