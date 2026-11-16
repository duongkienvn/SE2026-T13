import { CardMetadata } from '../metadata/CardMetadata';
import { Component, type ComponentType, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import type { SessionIdentity } from '../../../infrastructure/api/session-client';
import type { KanbanBoard } from '../../boards/kanban-api';
import type { Card } from '../decoder';
import { Button, spacing, typography, useTheme } from '../../../ui';

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

export function CardMetadataSection({
  context,
  section = CardMetadata,
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
