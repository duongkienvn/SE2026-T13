import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../../../infrastructure/api/errors';
import {
  BottomSheet,
  Button,
  ListRow,
  Separator,
  Skeleton,
  Surface,
  TextField,
  UnsavedChangesPrompt,
  radius,
  spacing,
  typography,
  useTheme,
} from '../../../ui';
import {
  useWorkspaceOnline,
  useWorkspaceRetryReady,
} from '../../workspaces/status';
import type { CardDetailSectionProps } from '../detail/sections';
import type { Attachment } from './api';
import { useAttachmentActions, useAttachments } from './hooks';
import { attachmentError, CARD_LIMIT, displayName, httpsUrl } from './policy';

type Sheet =
  | { mode: 'add' }
  | { mode: 'options' | 'remove'; row: Attachment }
  | {
      mode: 'form';
      row?: Attachment;
      url: string;
      name: string;
      initialUrl: string;
      initialName: string;
    };
const phaseLabels = {
  selecting: 'Selecting file…',
  intent: 'Reserving private upload…',
  uploading: 'Uploading file…',
  verifying: 'Verifying file with the server…',
  complete: 'File verified and attached.',
  failed: 'Upload not completed.',
  canceled: 'Upload canceled.',
};
function AttachmentIcon({ file = false }: { file?: boolean }) {
  const c = useTheme();
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{
        width: 40,
        height: 40,
        borderRadius: radius.control,
        backgroundColor: c.primaryTint,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {file ? (
        <View
          style={{
            width: 16,
            height: 20,
            borderWidth: 1.5,
            borderColor: c.primaryPressed,
            gap: 3,
            padding: 3,
          }}
        >
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              style={{ height: 1, backgroundColor: c.primaryPressed }}
            />
          ))}
        </View>
      ) : (
        <View
          style={{
            width: 18,
            height: 10,
            borderWidth: 2,
            borderColor: c.primaryPressed,
            borderRadius: radius.small,
            transform: [{ rotate: '-40deg' }],
          }}
        />
      )}
    </View>
  );
}
function OptionsIcon() {
  const c = useTheme();
  return (
    <View accessible={false} style={{ flexDirection: 'row', gap: 3 }}>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={{
            width: 3,
            height: 3,
            borderRadius: radius.pill,
            backgroundColor: c.textSecondary,
          }}
        />
      ))}
    </View>
  );
}
function metadata(row: Attachment) {
  const bytes = row.byteSize ?? 0;
  const size =
    bytes < 1024
      ? `${bytes} B`
      : bytes < 1024 * 1024
        ? `${(bytes / 1024).toFixed(1)} KiB`
        : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  return row.kind === 'URL'
    ? `${new URL(row.url!).hostname} · Link attachment`
    : `${row.mimeType === 'application/pdf' ? 'PDF document' : row.mimeType === 'text/plain' ? 'Text document' : row.mimeType?.split('/')[1].toUpperCase()} · ${size}`;
}
export function CardAttachments({ context }: CardDetailSectionProps) {
  const c = useTheme();
  const query = useAttachments(context);
  const actions = useAttachmentActions(context);
  const online = useWorkspaceOnline();
  const retryReady = useWorkspaceRetryReady(query.error, query.errorUpdatedAt);
  const actionReady = useWorkspaceRetryReady(actions.error, actions.errorAt);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [discard, setDiscard] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const writable =
    context.active &&
    context.canEdit &&
    !context.readOnly &&
    context.board.capabilities.canWriteBoard &&
    !context.board.isArchived &&
    !context.card.isArchived;
  const pages = query.data?.pages ?? [];
  const rows = [
    ...new Map(
      pages.flatMap((page) => page.data).map((row) => [row.id, row]),
    ).values(),
  ];
  const consistent = pages.every(
    (page) => page.meta.total === pages[0]?.meta.total,
  );
  const total = consistent ? pages[0]?.meta.total : undefined;
  const busy = actions.pending;
  const form = sheet?.mode === 'form' ? sheet : null;
  const dirty =
    form && (form.url !== form.initialUrl || form.name !== form.initialName);
  const error =
    localError ?? (actions.error ? attachmentError(actions.error) : null);
  const show = (next: Sheet | null) => {
    setLocalError(null);
    actions.clearError();
    setSheet(next);
  };
  const dismiss = () => {
    if (busy) return;
    if (dirty) setDiscard(true);
    else show(null);
  };
  const edit = (row?: Attachment) =>
    show({
      mode: 'form',
      row,
      url: row?.url ?? '',
      name: row?.displayName ?? '',
      initialUrl: row?.url ?? '',
      initialName: row?.displayName ?? '',
    });
  async function open(row: Attachment) {
    if (busy || !context.active || !online) return;
    if (row.kind === 'FILE') {
      show(null);
      await actions.view(row);
      return;
    }
    await actions.openLink(row);
  }
  async function save() {
    if (!form || busy || !writable || !online) return;
    setLocalError(null);
    let url: string | undefined, name: string | undefined;
    try {
      url = form.row?.kind === 'FILE' ? undefined : httpsUrl(form.url.trim());
      name = form.name.trim()
        ? displayName(form.name)
        : form.row
          ? displayName(form.name)
          : undefined;
    } catch (cause) {
      setLocalError(attachmentError(cause));
      return;
    }
    const ok = form.row
      ? await actions.edit(form.row, { url, displayName: name! })
      : await actions.createUrl({ url: url!, displayName: name });
    if (ok) show(null);
  }
  async function reload(row: Attachment) {
    try {
      const latest = await actions.reload(row);
      if (!latest) return;
      if (sheet?.mode === 'remove') show({ mode: 'remove', row: latest });
      else edit(latest);
    } catch (cause) {
      setLocalError(attachmentError(cause));
    }
  }
  const conflict =
    actions.error instanceof ApiError &&
    actions.error.code === 'ATTACHMENT_REVISION_CONFLICT';
  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <Text
          accessibilityRole="header"
          style={[typography.strong, { color: c.text, flex: 1 }]}
        >
          Attachments
        </Text>
        {total !== undefined && (
          <Text
            style={[
              typography.caption,
              typography.numeric,
              { color: c.textSecondary },
            ]}
          >
            {total} {total === 1 ? 'attachment' : 'attachments'}
          </Text>
        )}
        {writable && (
          <Button
            label="+ Add"
            accessibilityLabel="Add attachment"
            variant="link"
            onPress={() => show({ mode: 'add' })}
            disabled={
              busy ||
              !online ||
              actions.hasUpload ||
              total === undefined ||
              total >= CARD_LIMIT
            }
          />
        )}
      </View>
      {!online && (
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.supporting, { color: c.textSecondary }]}
        >
          You’re offline. Showing the last loaded attachments.
        </Text>
      )}
      {writable && total !== undefined && total >= CARD_LIMIT && (
        <Text style={[typography.supporting, { color: c.textSecondary }]}>
          This card has reached its 20-attachment limit. Remove an attachment
          before adding another.
        </Text>
      )}
      {query.isPending ? (
        <View accessibilityLabel="Loading attachments">
          <Skeleton height={64} />
          <Skeleton height={64} />
        </View>
      ) : null}
      {query.isError && (
        <Surface compact>
          <Text
            accessibilityRole="header"
            style={[typography.strong, { color: c.text }]}
          >
            Couldn’t load attachments
          </Text>
          <Text style={[typography.body, { color: c.textSecondary }]}>
            {attachmentError(query.error)}
          </Text>
          <Button
            label="Retry attachments"
            variant="link"
            disabled={!online || !retryReady || query.isFetching}
            onPress={() => {
              void query.refetch();
            }}
          />
        </Surface>
      )}
      {!consistent && (
        <Surface compact>
          <Text
            accessibilityLiveRegion="polite"
            style={[typography.body, { color: c.textSecondary }]}
          >
            Attachments changed while loading. Reload the list to see the latest
            count.
          </Text>
          <Button
            label="Reload attachment list"
            variant="link"
            disabled={!online || query.isFetching}
            onPress={() => {
              void query.refetch();
            }}
          />
        </Surface>
      )}
      {query.isSuccess && !rows.length && (
        <Surface>
          <Text style={[typography.strong, { color: c.text }]}>
            No attachments
          </Text>
          <Text style={[typography.body, { color: c.textSecondary }]}>
            {writable
              ? 'Add an HTTPS link or a private file to this card.'
              : 'This card has no attachments.'}
          </Text>
        </Surface>
      )}
      {rows.length > 0 && (
        <Surface compact>
          {rows.map((row, index) => (
            <View key={row.id}>
              {index > 0 && <Separator />}
              <ListRow
                title={row.displayName}
                subtitle={metadata(row)}
                leading={<AttachmentIcon file={row.kind === 'FILE'} />}
                onPress={() => {
                  void open(row);
                }}
                disabled={busy || !online || !context.active || !actionReady}
                accessibilityLabel={`${row.kind === 'FILE' ? 'Open private file' : 'Open link'} ${row.displayName}, ${metadata(row)}`}
                trailing={
                  <Button
                    label={`Attachment options for ${row.displayName}`}
                    variant="icon"
                    icon={<OptionsIcon />}
                    disabled={busy || !context.active}
                    onPress={() => show({ mode: 'options', row })}
                  />
                }
              />
            </View>
          ))}
        </Surface>
      )}
      {query.isFetching && !query.isPending && (
        <ActivityIndicator
          accessibilityLabel="Refreshing attachments"
          color={c.primaryPressed}
        />
      )}
      {query.hasNextPage && (
        <Button
          label="Load more attachments"
          variant="link"
          loading={query.isFetchingNextPage}
          disabled={!online || query.isFetching}
          onPress={() => {
            void query.fetchNextPage();
          }}
        />
      )}
      {actions.phase && (
        <Surface compact>
          <View accessibilityLiveRegion="polite" style={{ gap: spacing.sm }}>
            <Text style={[typography.body, { color: c.text }]}>
              {phaseLabels[actions.phase]}
            </Text>
            {actions.pending && (
              <ActivityIndicator
                accessibilityLabel="Attachment operation in progress"
                color={c.primaryPressed}
              />
            )}
            {actions.phase === 'uploading' && (
              <Text style={[typography.supporting, { color: c.textSecondary }]}>
                Byte progress isn’t available. Keep the app open.
              </Text>
            )}
          </View>
          {actions.hasUpload && (
            <View style={styles.actions}>
              {!actions.pending && (
                <Button
                  label="Retry upload"
                  variant="link"
                  disabled={!writable || !online || !actionReady}
                  onPress={() => {
                    void actions.retryUpload();
                  }}
                />
              )}
              <Button
                label="Cancel upload"
                variant="link"
                onPress={() => {
                  void actions.cancelUpload();
                }}
              />
            </View>
          )}
        </Surface>
      )}
      {actions.viewing && (
        <Surface compact>
          <Text
            accessibilityLiveRegion="polite"
            style={[typography.body, { color: c.text }]}
          >
            Private file preview is open. Close the retained file when you
            finish viewing.
          </Text>
          <Button
            label="Close private file"
            variant="secondary"
            onPress={actions.closeViewer}
          />
        </Surface>
      )}
      {actions.pending && !actions.viewing && !actions.hasUpload && !sheet && (
        <Button
          label="Cancel file operation"
          variant="link"
          onPress={actions.cancelDownload}
        />
      )}
      {actions.message && actions.phase !== 'complete' && (
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.body, { color: c.success }]}
        >
          {actions.message}
        </Text>
      )}
      {error && !sheet && (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={[typography.body, { color: c.danger }]}
        >
          {error}
        </Text>
      )}
      <BottomSheet
        visible={
          Boolean(sheet) && !discard && (sheet?.mode === 'options' || writable)
        }
        title={
          sheet?.mode === 'form'
            ? sheet.row
              ? 'Edit attachment'
              : 'Add HTTPS link'
            : sheet?.mode === 'remove'
              ? 'Remove attachment?'
              : sheet?.mode === 'options'
                ? 'Attachment options'
                : 'Add attachment'
        }
        onDismiss={dismiss}
        dismissible={!busy}
        showHandle
        respectReducedMotion
      >
        {error && (
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={[typography.body, { color: c.danger }]}
          >
            {error}
          </Text>
        )}
        {sheet?.mode === 'add' && (
          <>
            <Button
              label="Add HTTPS link"
              variant="secondary"
              onPress={() => edit()}
            />
            <Button
              label="Choose private file"
              variant="secondary"
              disabled={busy || !online || !actionReady}
              onPress={() => {
                show(null);
                void actions.select();
              }}
            />
            <Text style={[typography.supporting, { color: c.textSecondary }]}>
              PNG, JPEG, WebP, PDF or TXT · 10 MiB per file · 20 attachments per
              card · 100 MiB per board. Images: 16MP, 8192px per side. The
              server checks remaining quota.
            </Text>
          </>
        )}
        {sheet?.mode === 'options' && (
          <>
            <Text selectable style={[typography.strong, { color: c.text }]}>
              {sheet.row.displayName}
            </Text>
            <Text style={[typography.supporting, { color: c.textSecondary }]}>
              {metadata(sheet.row)}
            </Text>
            <Button
              label={
                sheet.row.kind === 'URL'
                  ? 'Open HTTPS link'
                  : 'Open private file'
              }
              onPress={() => {
                void open(sheet.row);
              }}
              disabled={busy || !online}
            />
            {sheet.row.kind === 'FILE' && (
              <Button
                label="Share private file"
                variant="secondary"
                disabled={busy || !online || !actionReady}
                onPress={() => {
                  const row = sheet.row;
                  show(null);
                  void actions.share(row);
                }}
              />
            )}
            {writable && (
              <>
                <Button
                  label="Edit attachment"
                  variant="secondary"
                  disabled={busy || !online}
                  onPress={() => edit(sheet.row)}
                />
                <Button
                  label="Remove attachment"
                  variant="destructive"
                  disabled={busy || !online}
                  onPress={() => show({ mode: 'remove', row: sheet.row })}
                />
              </>
            )}
          </>
        )}
        {form && (
          <>
            {form.row?.kind !== 'FILE' && (
              <TextField
                label="HTTPS URL"
                value={form.url}
                onChangeText={(url) => setSheet({ ...form, url })}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                maxLength={2048}
                editable={!busy && !actions.hasUncertainUrl}
              />
            )}
            <TextField
              label="Display name"
              hint={
                form.row ? '1–120 characters' : 'Optional · 1–120 characters'
              }
              value={form.name}
              onChangeText={(name) => setSheet({ ...form, name })}
              maxLength={120}
              editable={!busy && !actions.hasUncertainUrl}
            />
            <Button
              label={
                actions.hasUncertainUrl
                  ? 'Retry original link'
                  : 'Save attachment'
              }
              loading={busy}
              disabled={!online || !actionReady || conflict}
              onPress={() => {
                void save();
              }}
            />
            {conflict && form.row && (
              <Button
                label="Reload attachment"
                variant="secondary"
                onPress={() => {
                  void reload(form.row!);
                }}
              />
            )}
            <Button
              label="Cancel"
              variant="link"
              disabled={busy}
              onPress={dismiss}
            />
          </>
        )}
        {sheet?.mode === 'remove' && (
          <>
            <Text style={[typography.body, { color: c.textSecondary }]}>
              Remove “{sheet.row.displayName}” from this card? Other people may
              be using it.
            </Text>
            <Button
              label="Confirm remove attachment"
              variant="destructive"
              loading={busy}
              disabled={!online || conflict || !actionReady}
              onPress={() => {
                void actions.remove(sheet.row).then((ok) => {
                  if (ok) show(null);
                });
              }}
            />
            {conflict && (
              <Button
                label="Reload attachment"
                variant="secondary"
                onPress={() => {
                  void reload(sheet.row);
                }}
              />
            )}
            <Button
              label="Keep attachment"
              variant="link"
              disabled={busy}
              onPress={() => show(null)}
            />
          </>
        )}
      </BottomSheet>
      <UnsavedChangesPrompt
        visible={discard}
        title="Discard attachment draft?"
        message={
          actions.hasUncertainUrl
            ? 'The original link may already exist. Reopening this form later starts a new operation; check the refreshed list first.'
            : 'Your unsaved attachment changes will be lost.'
        }
        onKeepEditing={() => setDiscard(false)}
        onDiscard={() => {
          actions.discardUrl();
          setDiscard(false);
          show(null);
        }}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  heading: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
