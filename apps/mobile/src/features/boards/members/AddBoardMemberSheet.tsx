import { useState, type ReactNode } from 'react';
import { Text } from 'react-native';
import {
  BottomSheet,
  Button,
  TextField,
  typography,
  useTheme,
} from '../../../ui';
import { boardMemberEmail } from './api';

export function AddBoardMemberSheet({
  email,
  onEmailChange,
  pending,
  disabled,
  message,
  review,
  onAdd,
  onClose,
}: {
  email: string;
  onEmailChange: (value: string) => void;
  pending: boolean;
  disabled: boolean;
  message?: string;
  review?: ReactNode;
  onAdd: (email: string) => void;
  onClose: () => void;
}) {
  const c = useTheme();
  const [error, setError] = useState('');
  const [discard, setDiscard] = useState(false);
  const close = () => {
    if (pending) return;
    if (discard) setDiscard(false);
    else if (email.trim()) setDiscard(true);
    else onClose();
  };
  return (
    <BottomSheet
      visible
      title={discard ? 'Discard email draft?' : 'Add existing Kanvexa user'}
      dismissible={!pending}
      onDismiss={close}
      dismissLabel="Close add member form"
      showHandle
      respectReducedMotion
    >
      {discard ? (
        <>
          <Button
            label="Discard draft"
            variant="destructive"
            onPress={onClose}
          />
          <Button
            label="Keep editing"
            variant="secondary"
            onPress={() => setDiscard(false)}
          />
        </>
      ) : (
        <>
          <Text style={[typography.body, { color: c.textSecondary }]}>
            Enter the email of a registered Kanvexa user. They will be added to
            this Board as a MEMBER.
          </Text>
          <TextField
            label="Kanvexa account email"
            value={email}
            maxLength={320}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            spellCheck={false}
            editable={!pending && !review}
            error={error || undefined}
            onChangeText={(value) => {
              onEmailChange(value);
              setError('');
            }}
          />
          {!!message && (
            <Text
              accessibilityLiveRegion="polite"
              style={[typography.body, { color: c.danger }]}
            >
              {message}
            </Text>
          )}
          {review}
          <Button
            label="Add to Board"
            loading={pending}
            disabled={disabled || !email.trim()}
            onPress={() => {
              try {
                onAdd(boardMemberEmail(email));
              } catch {
                setError('Enter a valid email address, up to 320 characters.');
              }
            }}
          />
          <Button
            label="Cancel"
            variant="secondary"
            disabled={pending}
            onPress={close}
          />
        </>
      )}
    </BottomSheet>
  );
}
