import { useState } from 'react';
import { Text, View } from 'react-native';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { Button, Skeleton, spacing, typography, useTheme } from '../../ui';
import {
  isAccessDenied,
  type KanbanCard,
  type KanbanColumn,
} from '../boards/kanban-api';
import { useWorkspaceRetryReady } from '../workspaces/status';
import { useArchivedCards } from './queries';

export function ArchivedCardsList({
  identity,
  boardId,
  columns,
  onOpen,
  onRestore,
}: {
  identity: SessionIdentity;
  boardId: string;
  columns: readonly KanbanColumn[];
  onOpen: (card: KanbanCard) => void;
  onRestore?: (card: KanbanCard) => void;
}) {
  const c = useTheme();
  const archive = useArchivedCards(identity, boardId);
  const [selectedPage, setSelectedPage] = useState(0);
  const pages = archive.data?.pages ?? [];
  const latestPage = Math.max(0, pages.length - 1);
  const currentPage = Math.min(selectedPage, latestPage);
  const page = isAccessDenied(archive.error) ? undefined : pages[currentPage];
  const retryReady = useWorkspaceRetryReady(
    archive.error,
    archive.errorUpdatedAt,
  );
  async function next() {
    if (currentPage < latestPage) {
      setSelectedPage(currentPage + 1);
      return;
    }
    const result = await archive.fetchNextPage({ cancelRefetch: false });
    if (!result.isError && (result.data?.pages.length ?? 0) > currentPage + 1)
      setSelectedPage(currentPage + 1);
  }
  if (archive.isPending)
    return <Skeleton height={72} label="Loading archived cards" />;
  return (
    <>
      {archive.isError && (
        <>
          <Text
            accessibilityLiveRegion="polite"
            style={[typography.body, { color: c.danger }]}
          >
            Couldn’t load archived cards.
          </Text>
          <Button
            label="Retry archive"
            variant="secondary"
            disabled={!retryReady || archive.isFetching}
            onPress={() =>
              void (archive.isFetchNextPageError ? next() : archive.refetch())
            }
          />
        </>
      )}
      {!archive.isError && page?.meta.total === 0 && (
        <Text style={[typography.body, { color: c.textSecondary }]}>
          No archived cards.
        </Text>
      )}
      {page?.data.map((card) => (
        <View
          key={card.id}
          style={{
            gap: spacing.xs,
            borderBottomColor: c.border,
            borderBottomWidth: 1,
          }}
        >
          <Button
            label={card.title}
            variant="secondary"
            onPress={() => onOpen(card)}
          />
          <Text style={[typography.supporting, { color: c.textSecondary }]}>
            {columns.find(({ id }) => id === card.columnId)?.name ??
              'Original column'}
            {card.archivedAt &&
              ` · Archived ${new Date(card.archivedAt).toLocaleDateString()}`}
          </Text>
          {onRestore && (
            <Button
              label={`Restore ${card.title}`}
              variant="link"
              onPress={() => onRestore(card)}
            />
          )}
        </View>
      ))}
      {page && page.meta.totalPages > 1 && (
        <>
          <Text style={[typography.caption, { color: c.textSecondary }]}>
            Page {page.meta.page} of {page.meta.totalPages}
          </Text>
          {currentPage > 0 && (
            <Button
              label="Previous archive page"
              variant="link"
              onPress={() => setSelectedPage(currentPage - 1)}
            />
          )}
          {(currentPage < latestPage || archive.hasNextPage) &&
            !archive.isError && (
              <Button
                label="Next archive page"
                variant="link"
                loading={archive.isFetchingNextPage}
                disabled={archive.isFetching}
                onPress={() => void next()}
              />
            )}
        </>
      )}
    </>
  );
}
