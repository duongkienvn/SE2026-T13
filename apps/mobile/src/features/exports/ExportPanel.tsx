import { Text, View } from 'react-native';
import { Button, ProgressBar, spacing, typography, useTheme } from '../../ui';
import { formatBytes, type ExportController } from './useExport';

function Status({ children, tone }: { children: string; tone?: 'danger' }) {
  const c = useTheme();
  return (
    <Text
      accessibilityLiveRegion="polite"
      style={[
        typography.body,
        { color: tone === 'danger' ? c.danger : c.textSecondary },
      ]}
    >
      {children}
    </Text>
  );
}

/** Truthful states only: no success before 200 bytes are privately saved. */
export function ExportPanel({
  exporter,
  label,
  disabled,
  onStart,
}: {
  exporter: ExportController;
  label: string;
  disabled?: boolean;
  onStart: () => void;
}) {
  const { phase, cooldown, handing, online } = exporter;
  const downloading = phase.kind === 'downloading';
  const ready = phase.kind === 'ready';
  return (
    <View style={{ gap: spacing.sm }}>
      {!ready && (
        <Button
          label={label}
          loading={downloading}
          disabled={disabled || downloading || handing || !!cooldown || !online}
          onPress={onStart}
        />
      )}
      {!online && !downloading && (
        <Status>You’re offline. Reconnect to export.</Status>
      )}
      {downloading && (
        <>
          {phase.total ? (
            <ProgressBar
              value={Math.round((phase.received / phase.total) * 100)}
              label="Export download progress"
            />
          ) : null}
          <Status>
            {phase.received
              ? `Downloading… ${formatBytes(phase.received)}${phase.total ? ` of ${formatBytes(phase.total)}` : ''}`
              : 'Preparing your export… Large exports can take a minute.'}
          </Status>
          <Button
            label="Cancel export"
            variant="secondary"
            onPress={exporter.cancel}
          />
        </>
      )}
      {phase.kind === 'canceled' && (
        <Status>Export canceled. No file was saved.</Status>
      )}
      {phase.kind === 'error' && <Status tone="danger">{phase.message}</Status>}
      {!!cooldown && (
        <Status>{`You can export again in ${cooldown} seconds.`}</Status>
      )}
      {ready && (
        <>
          <Status>{`File ready: ${phase.filename} (${formatBytes(phase.size)}). It is stored privately on this device until you remove it or leave this screen.`}</Status>
          <Button
            label="Share or save"
            loading={handing}
            disabled={handing}
            onPress={() => void exporter.handoff('share')}
          />
          <Button
            label="Open"
            variant="secondary"
            disabled={handing}
            onPress={() => void exporter.handoff('open')}
          />
          <Button
            label="Remove file"
            variant="secondary"
            disabled={handing}
            onPress={exporter.remove}
          />
          {phase.handoff === 'offered' && (
            <Status>
              The system sheet closed. Kanvexa can’t confirm whether a copy was
              saved. Apps you chose may keep their own copy.
            </Status>
          )}
          {phase.handoff === 'share-unavailable' && (
            <Status tone="danger">
              Sharing isn’t available on this device. Try Open instead.
            </Status>
          )}
          {phase.handoff === 'open-unavailable' && (
            <Status tone="danger">
              No app on this device can open this file. Try Share or save.
            </Status>
          )}
        </>
      )}
      {phase.kind === 'removed' && (
        <Status tone={phase.failed ? 'danger' : undefined}>
          {phase.failed
            ? 'The private file could not be removed. Restart the app before exporting again.'
            : 'The private copy was removed from this app. Copies you shared elsewhere are not affected.'}
        </Status>
      )}
    </View>
  );
}
