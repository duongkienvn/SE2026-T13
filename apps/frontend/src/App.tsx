import { APP_NAME } from '@kanban/shared';
import { AppShell } from './app/layout/AppShell';
import { PageContainer } from './components/PageContainer';
import { PageHeader } from './components/PageHeader';
import { EmptyState } from './components/states';
import { LogoIcon } from './components/icons';

export default function App() {
  return (
    <AppShell>
      <PageContainer>
        <PageHeader
          title={APP_NAME}
          description="Collaborate on boards, columns and cards in real time."
        />
        <div className="mt-8">
          <EmptyState
            icon={<LogoIcon />}
            title="Nothing here yet"
            description="Boards, cards and collaboration features will appear here as they are built."
          />
        </div>
      </PageContainer>
    </AppShell>
  );
}
