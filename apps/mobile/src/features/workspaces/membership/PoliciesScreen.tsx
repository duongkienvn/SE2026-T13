import { useQuery } from '@tanstack/react-query';
import { WorkspaceType } from '@kanban/shared';
import { usePreventRemove } from 'expo-router';
import { useEffect, useState, type RefObject } from 'react';
import { Switch, Text, View } from 'react-native';
import { useMobileData } from '../../../infrastructure/query/DataProvider';
import {
  Button,
  ConfirmDialog,
  ErrorState,
  LoadingState,
  Surface,
  spacing,
  typography,
  useTheme,
} from '../../../ui';
import { useWorkspaceRetryReady, workspaceErrorMessage } from '../status';
import { policyFields, type WorkspacePolicies } from './decoder';
import { updateWorkspacePolicies } from './mutations';
import {
  canManageWorkspacePolicies,
  workspacePoliciesOptions,
} from './queries';
import { useWorkspaceAction } from './useWorkspaceAction';
import type { WorkspaceCollaborationContext } from './WorkspaceCollaborationScreen';

const fields: Record<keyof WorkspacePolicies, { label: string; hint: string }> =
  {
    boardCreationAdminOnly: {
      label: 'Only Workspace ADMINs can add Boards',
      hint: 'Controls who can create Boards or move Boards into this Workspace.',
    },
    boardInvitesEnabled: {
      label: 'Board owners can add Board members',
      hint: 'Board owners can add people to their Boards. Board membership grants access only to that Board.',
    },
    boardMembershipChangesEnabled: {
      label: 'Board owners can change Board membership',
      hint: 'Controls whether Board owners can remove people or change their Board roles.',
    },
    boardVisibilityChangesEnabled: {
      label: 'Board owners can change Board visibility',
      hint: 'Controls whether Board owners can change visibility on their Boards.',
    },
  };

export function PoliciesScreen({
  context,
  draftRef,
}: {
  context: WorkspaceCollaborationContext;
  draftRef: RefObject<Partial<WorkspacePolicies>>;
}) {
  const data = useMobileData();
  const c = useTheme();
  const { identity, id, workspace, active, online } = context;
  const [draft, setDraft] = useState(draftRef.current);
  const [exit, setExit] = useState<{ repeat: () => void }>();
  const [cancel, setCancel] = useState(false);
  const [saved, setSaved] = useState(false);
  const action = useWorkspaceAction(context);
  const query = useQuery({
    ...workspacePoliciesOptions(data, identity, id),
    enabled: active && online,
    refetchInterval: 30_000,
  });
  const retry = useWorkspaceRetryReady(query.error, query.errorUpdatedAt);
  const personal = workspace.type === WorkspaceType.PERSONAL;
  const policy = query.data;
  const canWrite = canManageWorkspacePolicies(workspace, policy);
  const changes: Partial<WorkspacePolicies> = {};
  for (const field of policyFields) {
    const value = draft[field];
    if (
      policy &&
      value !== undefined &&
      value !== policy[field] &&
      !(personal && field === 'boardCreationAdminOnly')
    )
      changes[field] = value;
  }
  const dirty = Object.keys(changes).length > 0;
  usePreventRemove(canWrite && (dirty || action.pending), ({ repeat }) =>
    setExit({ repeat }),
  );

  function update(next: Partial<WorkspacePolicies>) {
    draftRef.current = next;
    setDraft(next);
  }
  useEffect(() => {
    if (policy && !canWrite) {
      draftRef.current = {};
      setDraft({});
      setExit(undefined);
      setCancel(false);
    }
  }, [canWrite, draftRef, policy]);

  if (query.isError)
    return (
      <ErrorState
        title="Couldn’t load Workspace policies"
        description={workspaceErrorMessage(query.error)}
        action={
          <Button
            label="Retry policies"
            disabled={!online || !retry}
            onPress={() => void query.refetch()}
          />
        }
      />
    );
  if (!policy) return <LoadingState label="Loading Workspace policies" />;
  const blocked = action.disabled || context.checking || query.isFetching;
  return (
    <>
      {!canWrite && (
        <Text style={[typography.body, { color: c.textSecondary }]}>
          Workspace policies are read-only for your role.
        </Text>
      )}
      {policyFields.map((field) => {
        const { label, hint } = fields[field];
        const fixed = personal && field === 'boardCreationAdminOnly';
        return (
          <Surface key={field}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
              }}
            >
              <Text style={[typography.strong, { color: c.text, flex: 1 }]}>
                {label}
              </Text>
              <Switch
                accessibilityLabel={label}
                accessibilityHint={hint}
                value={
                  canWrite ? (draft[field] ?? policy[field]) : policy[field]
                }
                disabled={blocked || !canWrite || fixed}
                trackColor={{ false: c.controlBorder, true: c.primary }}
                onValueChange={(value) => {
                  setSaved(false);
                  action.clearError();
                  update({ ...draft, [field]: value });
                }}
              />
            </View>
            <Text style={[typography.supporting, { color: c.textSecondary }]}>
              {fixed ? 'This setting applies to Team Workspaces.' : hint}
            </Text>
          </Surface>
        );
      })}
      {saved && (
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.body, { color: c.text }]}
        >
          Workspace policies saved.
        </Text>
      )}
      {action.message && (
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.body, { color: c.danger }]}
        >
          {action.message}
        </Text>
      )}
      {action.mustReview && (
        <Button
          label="Check latest policies"
          variant="secondary"
          disabled={!online || query.isFetching}
          onPress={async () => {
            if ((await query.refetch()).isSuccess) action.reviewed();
          }}
        />
      )}
      {canWrite && (
        <>
          <Button
            label="Save policies"
            loading={action.pending}
            disabled={blocked || !dirty}
            onPress={() =>
              void action.run(
                (signal) =>
                  updateWorkspacePolicies(data, identity, id, changes, signal),
                () => {
                  update({});
                  setSaved(true);
                },
              )
            }
          />
          <Button
            label="Cancel changes"
            variant="secondary"
            disabled={!dirty || action.pending}
            onPress={() => setCancel(true)}
          />
        </>
      )}
      {(cancel || exit) && (
        <ConfirmDialog
          visible
          destructive
          title="Discard policy changes?"
          message="Your unsaved Workspace policy changes will be lost."
          confirmLabel="Discard changes"
          cancelLabel="Keep editing"
          loading={action.pending}
          onConfirm={() => {
            update({});
            setCancel(false);
            setExit(undefined);
            exit?.repeat();
          }}
          onCancel={() => {
            setCancel(false);
            setExit(undefined);
          }}
        />
      )}
    </>
  );
}
