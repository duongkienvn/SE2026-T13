import { useState } from 'react';
import { View } from 'react-native';
import { Scaffold } from '../../../../src/navigation/scaffold';
import { BottomSheet, Button, TextField, spacing } from '../../../../src/ui';

/** Device-only overlay and keyboard exercise; never included in production. */
export default function InvitationTest() {
  const [visible, setVisible] = useState(false);
  return (
    <View style={{ flex: 1 }}>
      <Scaffold title="Invitation" header />
      <View style={{ padding: spacing.lg }}>
        <Button label="Test overlay" onPress={() => setVisible(true)} />
      </View>
      <BottomSheet
        visible={visible}
        title="Test overlay"
        onDismiss={() => setVisible(false)}
      >
        <TextField label="Test keyboard" />
      </BottomSheet>
    </View>
  );
}
