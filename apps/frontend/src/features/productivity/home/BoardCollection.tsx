import type { HomeBoardSummary } from '@kanban/shared';
import { Link } from 'react-router';
import { ArrowRightIcon, ColumnsIcon } from '../../../components/icons';
import { Pagination } from '../../../components/Pagination';
import { formatRelativeTime } from '../../../lib/format';
import {
  backgroundStyle,
  useBackgroundPresets,
} from '../../boards/components/BoardBackground';
import { BoardStar } from '../../boards/components/BoardStar';
import { usePagedList } from './paging';

export const BOARD_PAGE_SIZE = 3;

export function BoardCollection({
  id,
  title,
  boards,
  viewAll,
  workspaceNames,
  updatedAt,
  showViewed = false,
  empty,
}: {
  id: string;
  title: string;
  boards: HomeBoardSummary[];
  viewAll: string;
  workspaceNames: Map<string, string>;
  /** When Home was fetched; an older snapshot never overrides a newer toggle. */
  updatedAt: number;
  showViewed?: boolean;
  empty: { title: string; text: string };
}) {
  const presets = useBackgroundPresets();
  const paged = usePagedList(boards, BOARD_PAGE_SIZE);
  const headingId = `home-${id}`;
  return (
    <section aria-labelledby={headingId} className="home-section">
      <div className="home-section-head">
        <h2 id={headingId}>{title}</h2>
        <div className="home-section-actions">
          {/* Pages sit in the heading row so both lists fit short screens. */}
          <Pagination
            label={`${title} pages`}
            page={paged.page}
            pageCount={paged.pageCount}
            onChange={paged.setPage}
            className="home-pager-inline"
          />
          <Link to={viewAll} className="home-view-all">
            View all <span className="sr-only">{title.toLowerCase()}</span>
            <ArrowRightIcon aria-hidden="true" />
          </Link>
        </div>
      </div>
      {boards.length === 0 ? (
        <div className="home-panel home-empty home-empty-compact">
          <h3>{empty.title}</h3>
          <p>{empty.text}</p>
          <Link to="/boards" className="home-link">
            Browse boards
          </Link>
        </div>
      ) : (
        <ul className="home-board-list">
          {paged.visible.map((board) => {
            const workspace = workspaceNames.get(board.workspaceId);
            const preset = presets.data?.find(
              (item) => item.id === board.backgroundPreset,
            );
            return (
              <li key={board.id} className="home-board">
                <span
                  className="home-board-thumb"
                  aria-hidden="true"
                  style={backgroundStyle(preset)}
                >
                  {!preset && <ColumnsIcon />}
                </span>
                <span className="home-board-body">
                  <Link
                    to={board.path}
                    className="home-board-name"
                    title={board.name}
                  >
                    {board.name}
                  </Link>
                  <span className="home-board-meta">
                    {showViewed && board.lastViewedAt ? (
                      <>
                        Viewed{' '}
                        <time dateTime={board.lastViewedAt}>
                          {formatRelativeTime(board.lastViewedAt)}
                        </time>
                      </>
                    ) : (
                      (workspace ?? '')
                    )}
                  </span>
                </span>
                <span className="home-board-star">
                  <BoardStar
                    boardId={board.id}
                    boardName={board.name}
                    isStarred={board.isStarred}
                    stateUpdatedAt={updatedAt}
                    compact
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
