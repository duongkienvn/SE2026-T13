import { type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from './controls';
import { radius, spacing, typography, useTheme } from './theme';

export function Overlay({
  visible,
  onDismiss,
  title,
  children,
  placement = 'center',
  dismissible = true,
}: {
  visible: boolean;
  onDismiss: () => void;
  title: string;
  children: ReactNode;
  placement?: 'center' | 'bottom';
  dismissible?: boolean;
}) {
  const c = useTheme();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (dismissible) onDismiss();
      }}
      statusBarTranslucent
    >
      <View
        style={{ flex: 1, backgroundColor: c.overlay }}
        accessibilityViewIsModal
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          disabled={!dismissible}
          onPress={dismissible ? onDismiss : undefined}
          style={{ flex: 1 }}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ maxHeight: '85%', justifyContent: 'flex-end' }}
        >
          <SafeAreaView
            edges={['bottom']}
            style={{
              backgroundColor: c.surface,
              borderTopLeftRadius: radius.surface,
              borderTopRightRadius: radius.surface,
              ...(placement === 'center'
                ? {
                    marginHorizontal: spacing.lg,
                    marginBottom: spacing.xxl,
                    borderRadius: radius.surface,
                  }
                : {}),
            }}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}
            >
              <Text
                accessibilityRole="header"
                style={[typography.section, { color: c.text }]}
              >
                {title}
              </Text>
              {children}
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
        {placement === 'center' && (
          <Pressable
            accessible={false}
            disabled={!dismissible}
            onPress={dismissible ? onDismiss : undefined}
            style={{ flex: 1 }}
          />
        )}
      </View>
    </Modal>
  );
}
export function BottomSheet(
  props: Omit<Parameters<typeof Overlay>[0], 'placement'>,
) {
  return <Overlay {...props} placement="bottom" />;
}
export function Dialog(
  props: Omit<Parameters<typeof Overlay>[0], 'placement'>,
) {
  return <Overlay {...props} placement="center" />;
}
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  destructive,
  loading,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
  loading?: boolean;
}) {
  const c = useTheme();
  return (
    <Dialog
      visible={visible}
      title={title}
      onDismiss={onCancel}
      dismissible={!loading}
    >
      <Text style={[typography.body, { color: c.textSecondary }]}>
        {message}
      </Text>
      <Button
        label={confirmLabel}
        onPress={onConfirm}
        variant={destructive ? 'destructive' : 'primary'}
        loading={loading}
      />
      <Button
        label={cancelLabel}
        onPress={onCancel}
        variant="secondary"
        disabled={loading}
      />
    </Dialog>
  );
}
export function UnsavedChangesPrompt({
  visible,
  onDiscard,
  onKeepEditing,
}: {
  visible: boolean;
  onDiscard: () => void;
  onKeepEditing: () => void;
}) {
  return (
    <ConfirmDialog
      visible={visible}
      title="Discard changes?"
      message="Your unsaved changes will be lost."
      confirmLabel="Discard"
      cancelLabel="Keep editing"
      destructive
      onConfirm={onDiscard}
      onCancel={onKeepEditing}
    />
  );
}
export function Snackbar({
  message,
  action,
}: {
  message: string;
  action?: ReactNode;
}) {
  const c = useTheme();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        backgroundColor: c.surfaceSoft,
        borderColor: c.border,
        borderWidth: 1,
        borderRadius: radius.control,
        padding: spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
      }}
    >
      <Text style={[typography.body, { color: c.text, flex: 1 }]}>
        {message}
      </Text>
      {action}
    </View>
  );
}
