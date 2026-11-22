import { useState } from 'react';
import { Text, View } from 'react-native';
import { BoardRole } from '@kanban/shared';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import {
  SegmentedControl,
  Surface,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import { ExportPanel } from './ExportPanel';
import type { BoardExportFormat } from './model';
import { useExport } from './useExport';

/**
 * Only an explicit Board OWNER (guest OWNER and archived Boards included).
 * Workspace ADMIN or read access never qualifies; the server still decides.
 */
export function canExportBoard(
  board: { currentUserRole?: BoardRole | null } | null | undefined,
): boolean {
  return board?.currentUserRole === BoardRole.OWNER;
}

export function BoardExportSection({
  identity,
  boardId,
  board,
  disabled,
}: {
  identity: SessionIdentity;
  boardId: string;
  board: { currentUserRole?: BoardRole | null };
  disabled?: boolean;
}) {
  const c = useTheme();
  const exporter = useExport(identity);
  const [format, setFormat] = useState<BoardExportFormat>('json');
  const denied = exporter.phase.kind === 'error' && exporter.phase.denied;
  if (!canExportBoard(board)) return null;
  return (
    <Surface>
      <View style={{ gap: spacing.sm }}>
        <Text
          accessibilityRole="header"
          style={[typography.section, { color: c.text }]}
        >
          Export board
        </Text>
        {denied ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[typography.body, { color: c.danger }]}
          >
            Board export is unavailable. Only a current board owner can export
            this board.
          </Text>
        ) : (
          <>
            <Text style={[typography.supporting, { color: c.textSecondary }]}>
              JSON keeps the full structure; CSV has one row per card.
              Attachments aren’t included. Up to 10,000 cards or 20 MiB. The
              file may contain private board information.
            </Text>
            <SegmentedControl
              label="Export format"
              value={format}
              onChange={(next) => {
                if (!exporter.busy) setFormat(next as BoardExportFormat);
              }}
              options={[
                { value: 'json', label: 'JSON' },
                { value: 'csv', label: 'CSV' },
              ]}
            />
            <ExportPanel
              exporter={exporter}
              label={`Export board (${format.toUpperCase()})`}
              disabled={disabled}
              onStart={() =>
                void exporter.start({ kind: 'board', boardId, format })
              }
            />
          </>
        )}
      </View>
    </Surface>
  );
}
