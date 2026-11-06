import { Button } from '../../../components/Button';
import { ColumnsIcon, PlusIcon } from '../../../components/icons';
import './boards-empty-state.css';

export function BoardsEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <section
      className="boards-empty-state"
      aria-labelledby="boards-empty-heading"
    >
      <div className="boards-empty-state__icon" aria-hidden="true">
        <ColumnsIcon />
        <span />
      </div>
      <h2 id="boards-empty-heading">Your next big idea starts here</h2>
      <p>
        Create your first board to organize tasks, track progress, and
        collaborate with your team.
      </p>
      <Button
        size="lg"
        className="boards-empty-state__create"
        onClick={onCreate}
      >
        <PlusIcon />
        Create your first board
      </Button>
    </section>
  );
}
