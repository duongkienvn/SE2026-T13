import { useQuery } from '@tanstack/react-query';
import { useIsFocused, usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSessionSnapshot } from '../../../infrastructure/auth/SessionProvider';
import type { SessionIdentity } from '../../../infrastructure/api/session-client';
import { useMobileData } from '../../../infrastructure/query/DataProvider';
import { ResourceBoundary } from '../../../navigation/resource-boundary';
import {
  destinationPath,
  parsePath,
  type Destination,
  type ResourceId,
} from '../../../navigation/routes';
import { useSession } from '../../../navigation/session-context';
import { Button, ErrorState, spacing, typography, useTheme } from '../../../ui';
import type { WorkspaceSummary } from '../decoder';
import { isWorkspaceDenied } from '../queries';
import {
  useWorkspaceOnline,
  useWorkspaceRetryReady,
  workspaceErrorMessage,
} from '../status';
import { MembersDirectory } from './MembersDirectory';
import { GuestsDirectory } from './GuestsDirectory';
import { PoliciesScreen } from './PoliciesScreen';
import type { WorkspacePolicies } from './decoder';
import { workspaceCapabilityOptions } from './queries';

export const workspaceRefreshInterval = 30_000;

export type WorkspaceCollaborationContext = {
  id: ResourceId;
  identity: SessionIdentity;
  workspace: WorkspaceSummary;
  active: boolean;
  online: boolean;
  checking: boolean;
};

export function WorkspaceCollaborationScreen() {
  const destination = parsePath(usePathname());
  const session = useSessionSnapshot();
  if (
    destination?.kind !== 'workspaceSection' ||
    session.status !== 'authenticated'
  )
    return <ResourceBoundary access="unavailable" />;
  return (
    <VerifiedCollaboration
      key={`${session.user.id}:${session.generation}:${destination.workspaceId}:${destination.section}`}
      destination={destination}
      identity={{ userId: session.user.id, generation: session.generation }}
    />
  );
}

export const workspaceSectionLabels = {
  members: 'Members',
  guests: 'Guests',
  policies: 'Permissions',
} as const;

function VerifiedCollaboration({
  destination,
  identity,
}: {
  destination: Extract<Destination, { kind: 'workspaceSection' }>;
  identity: SessionIdentity;
}) {
  const data = useMobileData();
  const c = useTheme();
  const session = useSession();
  const active = useIsFocused();
  const online = useWorkspaceOnline();
  const id = destination.workspaceId;
  const policyDraft = useRef<Partial<WorkspacePolicies>>({});
  const options = workspaceCapabilityOptions(data, identity, id);
  const readable = data.resources.readable(options.queryKey);
  const detail = useQuery({
    ...options,
    enabled: active && readable && online,
    staleTime: 0,
    refetchInterval: workspaceRefreshInterval,
    refetchOnMount: 'always',
    retry: false,
  });
  const retry = useWorkspaceRetryReady(detail.error, detail.errorUpdatedAt);
  useEffect(() => {
    if (!readable || isWorkspaceDenied(detail.error)) policyDraft.current = {};
  }, [readable, detail.error]);
  if (!readable || isWorkspaceDenied(detail.error))
    return <ResourceBoundary access="unavailable" />;
  if (!online && !detail.data)
    return (
      <ErrorState
        title="Connection unavailable"
        description="Reconnect to verify Workspace access."
      />
    );
  if (detail.isError)
    return (
      <ErrorState
        title="Couldn’t verify Workspace access"
        description={workspaceErrorMessage(detail.error)}
        action={
          <Button
            label="Retry workspace"
            disabled={!retry}
            onPress={() => void detail.refetch()}
          />
        }
      />
    );
  if (
    !detail.isFetchedAfterMount ||
    !detail.data ||
    session.status !== 'authenticated'
  )
    return <ResourceBoundary access="checking" />;
  const context = {
    id,
    identity,
    workspace: detail.data,
    active,
    online,
    checking: detail.isFetching,
  };
  return (
    <ResourceBoundary
      access={{
        status: 'allowed',
        sessionKey: session.sessionKey,
        resourcePath: destinationPath(destination),
      }}
    >
      <SafeAreaView
        edges={['left', 'right', 'bottom']}
        style={{ flex: 1, backgroundColor: c.background }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}
          >
            <Text
              accessibilityRole="header"
              style={[typography.title, { color: c.text }]}
            >
              {workspaceSectionLabels[destination.section]}
            </Text>
            <Text style={[typography.body, { color: c.textSecondary }]}>
              {detail.data.name}
            </Text>
            {!online && (
              <Text
                accessibilityLiveRegion="polite"
                style={[typography.body, { color: c.textSecondary }]}
              >
                You’re offline. Reconnect to refresh Workspace access.
              </Text>
            )}
            {destination.section === 'members' && (
              <MembersDirectory context={context} />
            )}
            {destination.section === 'guests' && (
              <GuestsDirectory context={context} />
            )}
            {destination.section === 'policies' && (
              <PoliciesScreen context={context} draftRef={policyDraft} />
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ResourceBoundary>
  );
}
