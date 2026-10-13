import { FolderIcon } from '../components/icons';
import { usePageTitle } from '../hooks/usePageTitle';
import { PageContainer } from '../components/PageContainer';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/states';

/** Signed-in landing page. The board list arrives with the Boards feature. */
export function BoardsPage() {
  usePageTitle('Boards');
  return (
    <PageContainer>
      <PageHeader
        title="Boards"
        description="Organize your work with Kanban boards for different projects and teams."
      />
      <div className="mt-8">
        <EmptyState
          icon={<FolderIcon />}
          title="Boards are coming soon"
          description="Creating and opening boards will be available in an upcoming release."
        />
      </div>
    </PageContainer>
  );
}
