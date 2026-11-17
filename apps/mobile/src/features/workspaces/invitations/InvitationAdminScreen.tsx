import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { ApiError } from '../../../infrastructure/api/errors';
import { sameIdentity } from '../../../infrastructure/api/session-client';
import { useMobileData } from '../../../infrastructure/query/DataProvider';
import {
  Button,
  ConfirmDialog,
  FilterChip,
  Surface,
  spacing,
  typography,
  useTheme,
} from '../../../ui';
import { RosterPage, useRosterPage } from '../membership/RosterPage';
import { useWorkspaceAction } from '../membership/useWorkspaceAction';
import type { WorkspaceCollaborationContext } from '../membership/WorkspaceCollaborationScreen';
import { isWorkspaceDenied } from '../queries';
import {
  invitationStatuses,
  type InvitationStatus,
  type WorkspaceInvitation,
} from './decoder';
import {
  deliveryLabel,
  InvitationReceipt,
  InviteMemberSheet,
} from './InviteMemberSheet';
import { adminInvitationError, writeInvitation } from './mutations';
import { clearInvitationHistory, invitationHistoryOptions } from './queries';

const canRevoke = (row: WorkspaceInvitation) =>
  row.status === 'PENDING' &&
  !row.consumedAt &&
  !row.revokedAt &&
  !row.declinedAt &&
  Date.parse(row.expiresAt) > Date.now();

export function InvitationAdminScreen({
  context,
}: {
  context: WorkspaceCollaborationContext;
}) {
  const { identity, id, active, online, checking } = context;
  const data = useMobileData();
  const c = useTheme();
  const roster = useRosterPage();
  const [status, setStatus] = useState<InvitationStatus>();
  const [issuing, setIssuing] = useState(false);
  const [candidate, setCandidate] = useState<WorkspaceInvitation>();
  const [receipt, setReceipt] = useState<WorkspaceInvitation>();
  const [revoked, setRevoked] = useState(false);
  const [denied, setDenied] = useState(false);
  const action = useWorkspaceAction(context, adminInvitationError);
  const history = useQuery({
    ...invitationHistoryOptions(data, identity, id, roster.page, status),
    enabled: active && online && !denied,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  });
  const forbidden = isWorkspaceDenied(history.error);
  useEffect(() => {
    if (!forbidden) return;
    setDenied(true);
    setReceipt(undefined);
    setIssuing(false);
    setCandidate(undefined);
    if (sameIdentity(identity, data.getIdentity()))
      clearInvitationHistory(data, identity, id);
  }, [data, forbidden, id, identity]);
  if (denied || forbidden)
    return (
      <Text style={[typography.body, { color: c.danger }]}>
        Invitation history is unavailable. Return to Members and check your
        Workspace access.
      </Text>
    );
  const blocked = action.disabled || checking;
  const latest = history.data?.data.find(({ id }) => id === candidate?.id);
  return (
    <>
      <Button
        label="Invite member"
        disabled={blocked || !!candidate}
        onPress={() => {
          action.clearError();
          setRevoked(false);
          setIssuing(true);
        }}
      />
      {receipt && <InvitationReceipt invitation={receipt} />}
      {revoked && (
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.body, { color: c.text }]}
        >
          Invitation revoked.
        </Text>
      )}
      {action.message && !issuing && !candidate && (
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.body, { color: c.danger }]}
        >
          {action.message}
        </Text>
      )}
      {action.mustReview && (
        <Button
          label="Check latest invitations"
          disabled={!online || history.isFetching}
          onPress={async () => {
            if ((await history.refetch()).isSuccess) action.reviewed();
          }}
        />
      )}
      <Text
        accessibilityRole="header"
        style={[typography.title, { color: c.text }]}
      >
        Invitation history
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {([undefined, ...invitationStatuses] as const).map((filter) => (
          <FilterChip
            key={filter ?? 'all'}
            label={filter ?? 'All statuses'}
            selected={filter === status}
            disabled={!online || action.pending}
            onPress={() => {
              roster.setPage(1);
              setStatus(filter);
            }}
          />
        ))}
      </View>
      <RosterPage
        roster={roster}
        query={history}
        online={online}
        itemLabel="invitation"
        empty="No invitations match this status."
        render={(row) => (
          <Surface key={row.id}>
            <Text style={[typography.strong, { color: c.text }]}>
              {row.email}
            </Text>
            <Text style={[typography.body, { color: c.text }]}>
              {row.role} · {row.status}
            </Text>
            <Text style={[typography.body, { color: c.textSecondary }]}>
              {deliveryLabel[row.sendState]}
            </Text>
            <Text style={[typography.supporting, { color: c.textSecondary }]}>
              Requested {new Date(row.createdAt).toLocaleString()}
            </Text>
            <Text style={[typography.supporting, { color: c.textSecondary }]}>
              Expires {new Date(row.expiresAt).toLocaleString()}
            </Text>
            {canRevoke(row) && (
              <Button
                variant="link"
                label={'Revoke invitation for ' + row.email}
                disabled={blocked || history.isFetching}
                onPress={() => {
                  action.clearError();
                  setRevoked(false);
                  setCandidate(row);
                }}
              />
            )}
          </Surface>
        )}
      />
      {issuing && (
        <InviteMemberSheet
          pending={action.pending}
          blocked={blocked}
          message={action.message}
          onClose={() => setIssuing(false)}
          onIssue={(email) =>
            void action.run(
              (signal) =>
                writeInvitation(data, identity, id, signal, (api) =>
                  api.issue(email, signal),
                ),
              (row) => {
                setReceipt(row);
                setIssuing(false);
              },
            )
          }
        />
      )}
      {candidate && (
        <ConfirmDialog
          visible
          destructive
          title="Revoke this invitation?"
          message={
            action.message ??
            'Revoking this pending invitation prevents it from being accepted. Manage existing memberships from Members.'
          }
          confirmLabel="Revoke invitation"
          loading={action.pending}
          confirmDisabled={
            blocked || history.isFetching || !latest || !canRevoke(latest)
          }
          onCancel={() => setCandidate(undefined)}
          onConfirm={() =>
            void action.run(
              (signal) =>
                writeInvitation(data, identity, id, signal, (api) => {
                  if (!latest || !canRevoke(latest))
                    throw new ApiError('http', { status: 409 });
                  return api.revoke(candidate.id, signal);
                }),
              () => {
                setRevoked(true);
                setReceipt(undefined);
                setCandidate(undefined);
              },
            )
          }
        />
      )}
    </>
  );
}
