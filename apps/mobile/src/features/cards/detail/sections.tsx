import {
  Component,
  useEffect,
  type ComponentType,
  type ReactNode,
} from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { SessionIdentity } from '../../../infrastructure/api/session-client';
import type { KanbanBoard } from '../../boards/kanban-api';
import type { Card } from '../decoder';
import {
  AvatarStack,
  Button,
  Surface,
  spacing,
  typography,
  useTheme,
} from '../../../ui';
import { useMobileData } from '../../../infrastructure/query/DataProvider';
import { useKanbanCatalogs } from '../../boards/kanban-queries';
import { createKanbanApi } from '../../boards/kanban-api';
import { queryKeys } from '../../../infrastructure/query/keys';

export type CardDetailContext = {
  boardId: string;
  cardId: string;
  identity: SessionIdentity;
  board: KanbanBoard;
  card: Card;
  readOnly: boolean;
  canEdit: boolean;
  active: boolean;
  refreshCard: () => Promise<unknown>;
};
export type CardDetailSectionProps = { context: CardDetailContext };
export type CardDetailSections = {
  Metadata?: ComponentType<CardDetailSectionProps>;
  Checklists?: ComponentType<CardDetailSectionProps>;
  Attachments?: ComponentType<CardDetailSectionProps>;
  Comments?: ComponentType<CardDetailSectionProps>;
};

/** Boundaries catch render failures; section queries render their own async states. */
class SectionBoundary extends Component<
  {
    children: ReactNode;
    fallback: (retry: () => void) => ReactNode;
  },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  // Never log component errors containing private section values.
  componentDidCatch() {}
  render() {
    return this.state.failed
      ? this.props.fallback(() => this.setState({ failed: false }))
      : this.props.children;
  }
}

export function CardSectionFrame({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const c = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <Text
        accessibilityRole="header"
        style={[typography.strong, { color: c.text }]}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

function SectionMount({
  title,
  section: Section,
  context,
}: {
  title: string;
  section?: ComponentType<CardDetailSectionProps>;
  context: CardDetailContext;
}) {
  const c = useTheme();
  if (!Section) return null;
  return (
    <SectionBoundary
      key={`${context.identity.userId}:${context.identity.generation}:${context.boardId}:${context.cardId}`}
      fallback={(retry) => (
        <CardSectionFrame title={title}>
          <Text
            accessibilityLiveRegion="polite"
            style={[typography.body, { color: c.textSecondary }]}
          >
            This section couldn’t be displayed. Other card details are still
            available.
          </Text>
          <Button
            label={`Retry ${title.toLowerCase()}`}
            variant="link"
            onPress={retry}
          />
        </CardSectionFrame>
      )}
    >
      <Section context={context} />
    </SectionBoundary>
  );
}

/** MOB-18 base metadata is read-only. DTO contains IDs, not member profiles. */
function BaseMetadata({
  context: { card, board, boardId, identity, active },
}: CardDetailSectionProps) {
  const c = useTheme();
  const data = useMobileData();
  const zone = useQuery({
    queryKey: [...queryKeys.me(identity), 'time-zone'],
    queryFn: ({ signal }) =>
      createKanbanApi(data.api, identity, boardId).timeZone(signal),
    enabled: active && !!(card.startDate || card.dueDate),
  });
  const mayReadMembers =
    board.currentUserRole !== null && card.assignees.length > 0;
  const catalogs = useKanbanCatalogs(
    data.api,
    identity,
    boardId,
    false,
    active && mayReadMembers,
  );
  const members =
    mayReadMembers &&
    catalogs.members.isFetchedAfterMount &&
    !catalogs.members.isError
      ? catalogs.memberItems
      : [];
  const known = members.filter(({ id }) =>
    card.assignees.some(({ userId }) => userId === id),
  );
  useEffect(() => {
    if (
      active &&
      mayReadMembers &&
      known.length < card.assignees.length &&
      catalogs.members.hasNextPage &&
      !catalogs.members.isFetching &&
      !catalogs.members.isError
    )
      void catalogs.members.fetchNextPage({ cancelRefetch: false });
  }, [
    active,
    mayReadMembers,
    known.length,
    card.assignees.length,
    catalogs.members.hasNextPage,
    catalogs.members.isFetching,
    catalogs.members.isError,
    catalogs.members.fetchNextPage,
  ]);
  const { width, fontScale } = useWindowDimensions();
  const stacked = width / Math.max(1, fontScale) < 360;
  const date = (value: string | null) =>
    value
      ? new Date(value).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: zone.data,
        })
      : 'Not set';
  return (
    <View
      style={{
        flexDirection: stacked ? 'column' : 'row',
        gap: spacing.sm,
      }}
      testID="card-detail-metadata"
    >
      <View style={{ flex: stacked ? undefined : 1, minWidth: 0 }}>
        <Surface compact>
          <Text style={[typography.supporting, { color: c.textSecondary }]}>
            Assignees
          </Text>
          {!!known.length && (
            <AvatarStack
              people={known.map(({ name, avatarUrl }) => ({
                name,
                source: avatarUrl ? { uri: avatarUrl } : undefined,
              }))}
              accessibilityLabel={`Assignees: ${known.map(({ name }) => name).join(', ')}`}
            />
          )}
          {card.assignees.length ? (
            card.assignees.map(({ userId }) => (
              <Text
                key={userId}
                selectable
                style={[typography.supporting, { color: c.text }]}
                accessibilityLabel={`Assigned user ${userId}`}
              >
                {members.find(({ id }) => id === userId)?.name ?? userId}
              </Text>
            ))
          ) : (
            <Text style={[typography.body, { color: c.text }]}>Unassigned</Text>
          )}
        </Surface>
      </View>
      <View style={{ flex: stacked ? undefined : 1, minWidth: 0 }}>
        <Surface compact>
          <Text style={[typography.supporting, { color: c.textSecondary }]}>
            Start date
          </Text>
          <Text selectable style={[typography.body, { color: c.text }]}>
            {date(card.startDate)}
          </Text>
          <Text style={[typography.supporting, { color: c.textSecondary }]}>
            Due date
          </Text>
          <Text selectable style={[typography.body, { color: c.text }]}>
            {date(card.dueDate)}
          </Text>
          {(card.startDate || card.dueDate) && (
            <Text style={[typography.caption, { color: c.textSecondary }]}>
              {zone.data ??
                `Device time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`}
            </Text>
          )}
        </Surface>
      </View>
    </View>
  );
}

export function CardMetadataSection({
  context,
  section = BaseMetadata,
}: CardDetailSectionProps & {
  section?: ComponentType<CardDetailSectionProps>;
}) {
  return <SectionMount title="Metadata" context={context} section={section} />;
}
export function CardChecklistsSection({
  context,
  section,
}: CardDetailSectionProps & {
  section?: ComponentType<CardDetailSectionProps>;
}) {
  return (
    <SectionMount title="Checklists" context={context} section={section} />
  );
}
export function CardAttachmentsSection({
  context,
  section,
}: CardDetailSectionProps & {
  section?: ComponentType<CardDetailSectionProps>;
}) {
  return (
    <SectionMount title="Attachments" context={context} section={section} />
  );
}
export function CardCommentsSection({
  context,
  section,
}: CardDetailSectionProps & {
  section?: ComponentType<CardDetailSectionProps>;
}) {
  return <SectionMount title="Comments" context={context} section={section} />;
}
