import { useState, type ReactNode } from 'react';
import { Text } from 'react-native';
import {
  BottomSheet,
  Button,
  TextField,
  typography,
  useTheme,
} from '../../../ui';
import {
  invitationEmail,
  type DeliveryState,
  type WorkspaceInvitation,
} from './decoder';

export const deliveryLabel: Record<DeliveryState, string> = {
  UNAVAILABLE: 'Email delivery unavailable',
  DISPATCHING: 'Sending email',
  SENT: 'Email sent',
  FAILED: 'Email delivery failed',
  UNKNOWN: 'Email delivery unconfirmed',
};

export function InviteMemberSheet({
  pending,
  blocked,
  message,
  review,
  onIssue,
  onClose,
}: {
  pending: boolean;
  blocked: boolean;
  message?: string;
  review?: ReactNode;
  onIssue: (email: string) => void;
  onClose: () => void;
}) {
  const c = useTheme();
  const [email, setEmail] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [discard, setDiscard] = useState(false);
  const close = () => {
    if (discard) setDiscard(false);
    else if (email.trim()) setDiscard(true);
    else onClose();
  };
  return (
    <BottomSheet
      visible
      title={discard ? 'Discard invitation draft?' : 'Invite member'}
      dismissible={!pending}
      onDismiss={close}
      dismissLabel="Close invitation form"
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
            Workspace role: MEMBER
          </Text>
          <TextField
            label="Recipient email"
            value={email}
            maxLength={320}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!pending && !review}
            onChangeText={(value) => {
              setEmail(value);
              setInvalid(false);
            }}
            error={invalid ? 'Enter a valid email address.' : undefined}
          />
          {message && (
            <Text
              accessibilityLiveRegion="polite"
              style={[typography.body, { color: c.danger }]}
            >
              {message}
            </Text>
          )}
          {review}
          <Button
            label="Request invitation"
            loading={pending}
            disabled={blocked}
            onPress={() => {
              const normalized = invitationEmail(email);
              if (normalized) onIssue(normalized);
              else setInvalid(true);
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

export function InvitationReceipt({
  invitation,
}: {
  invitation: WorkspaceInvitation;
}) {
  const c = useTheme();
  return (
    <Text
      accessibilityLiveRegion="polite"
      style={[typography.body, { color: c.text }]}
    >
      Invitation requested. {invitation.status}.{' '}
      {deliveryLabel[invitation.sendState]}.
      {(invitation.sendState === 'UNAVAILABLE' ||
        invitation.sendState === 'FAILED' ||
        invitation.sendState === 'UNKNOWN') &&
        ' Check invitation history before requesting another email.'}
    </Text>
  );
}
