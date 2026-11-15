import { BoardRole } from '@kanban/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { destinationPath, type ResourceId } from '../../navigation/routes';
import { BottomSheet, Button, typography, useTheme } from '../../ui';

/**
 * Directory overflow menu. Brief actions stay in a sheet; multi-step Board
 * lifecycle work lives on the pushed Board settings screen.
 */
export function BoardRowActions({
  board,
  disabled,
  current,
  onEdit,
}: {
  board: {
    id: ResourceId;
    name: string;
    isArchived: boolean;
    currentUserRole: string | null;
  };
  disabled: boolean;
  /** The row still reflects the latest verified directory snapshot. */
  current: () => boolean;
  onEdit: () => void;
}) {
  const c = useTheme();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const canEdit =
    !board.isArchived && board.currentUserRole === BoardRole.OWNER;
  const choose = (action: () => void) => {
    setOpen(false);
    if (!disabled && current()) action();
  };
  return (
    <>
      <Button
        label={`More actions for ${board.name}`}
        variant="icon"
        icon={<Text style={[typography.strong, { color: c.text }]}>⋯</Text>}
        disabled={disabled}
        onPress={() => {
          if (!disabled && current()) setOpen(true);
        }}
      />
      <BottomSheet
        visible={open}
        title={board.name}
        onDismiss={() => setOpen(false)}
        showHandle
        respectReducedMotion
      >
        {canEdit && (
          <Button
            label="Edit details"
            variant="secondary"
            disabled={disabled}
            onPress={() => choose(onEdit)}
          />
        )}
        <Button
          label="Board settings"
          variant="secondary"
          disabled={disabled}
          onPress={() =>
            choose(() =>
              router.push(
                destinationPath({ kind: 'boardSettings', boardId: board.id }),
              ),
            )
          }
        />
        <Button
          label="Cancel"
          variant="secondary"
          onPress={() => setOpen(false)}
        />
      </BottomSheet>
    </>
  );
}
