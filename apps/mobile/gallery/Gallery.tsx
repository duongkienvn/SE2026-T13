import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  AppHeader,
  Avatar,
  AvatarStack,
  BoardRow,
  BoardTile,
  BottomSheet,
  Button,
  CardPreview,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  OfflineState,
  FilterChip,
  FormFooter,
  LoadingState,
  NotificationRow,
  PasswordField,
  PreferenceSwitch,
  ScreenHeader,
  SearchField,
  SectionHeader,
  SegmentedControl,
  Skeleton,
  Snackbar,
  StatTile,
  StatusChip,
  TaskRow,
  TextField,
  ThemeContext,
  type ThemeMode,
  spacing,
  typography,
  useTheme,
} from '../src/ui';

function Examples() {
  const c = useTheme();
  const [text, setText] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [selected, setSelected] = useState('one');
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
      >
        <AppHeader subtitle="Component gallery" />
        <ScreenHeader
          title="Native components"
          subtitle="Development showcase"
        />
        <SectionHeader title="Actions" />
        <Button label="Open sheet" onPress={() => setSheet(true)} />
        <Button
          label="Open confirmation"
          variant="secondary"
          onPress={() => setDialog(true)}
        />
        <Button
          label="Destructive example"
          variant="destructive"
          onPress={() => setDialog(true)}
        />
        <Button label="Unavailable" disabled onPress={() => {}} />
        <Button label="Loading" loading onPress={() => {}} />
        <SectionHeader title="Inputs" />
        <TextField
          label="Example input"
          value={text}
          onChangeText={setText}
          error={text.length > 0 ? 'Example validation message' : undefined}
        />
        <SearchField
          label="Search example"
          value={text}
          onChangeText={setText}
        />
        <PasswordField label="Password example" />
        <SectionHeader title="Selection" />
        <SegmentedControl
          label="Example options"
          value={selected}
          onChange={setSelected}
          options={[
            { label: 'Option one', value: 'one' },
            { label: 'Option two', value: 'two' },
          ]}
        />
        <PreferenceSwitch
          label="Example preference"
          value={enabled}
          onValueChange={setEnabled}
        />
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}
        >
          <FilterChip
            label="Filter"
            selected={enabled}
            onPress={() => setEnabled(!enabled)}
          />
          <StatusChip label="Success" tone="success" />
        </View>
        <SectionHeader title="People and content" />
        <Avatar name="Example Person" />
        <AvatarStack
          people={[{ name: 'Example Person' }, { name: 'Another Person' }]}
        />
        <StatTile label="Example count" value="12" />
        <BoardTile title="Board title example" subtitle="Supporting text" />
        <BoardRow title="Board row example" subtitle="Supporting text" />
        <CardPreview title="Card preview example">
          <Text style={[typography.body, { color: c.textSecondary }]}>
            Supporting text
          </Text>
        </CardPreview>
        <TaskRow title="Task row example" subtitle="Supporting text" />
        <NotificationRow
          title="Notification example"
          subtitle="Supporting text"
        />
        <SectionHeader title="Feedback" />
        <Skeleton />
        <LoadingState />
        <EmptyState
          title="Nothing to show"
          description="Example empty state."
        />
        <ErrorState
          title="Something went wrong"
          description="Example error state."
        />
        <OfflineState title="Offline" description="Example offline state." />
        <Snackbar message="Example message" />
        <FormFooter
          primaryLabel="Example action"
          onPrimary={() => setDialog(true)}
        />
      </ScrollView>
      <BottomSheet
        visible={sheet}
        title="Example sheet"
        onDismiss={() => setSheet(false)}
      >
        <TextField label="Input in sheet" value={text} onChangeText={setText} />
        <Button label="Close" onPress={() => setSheet(false)} />
      </BottomSheet>
      <ConfirmDialog
        visible={dialog}
        title="Example confirmation"
        message="This only closes the example."
        confirmLabel="Confirm"
        destructive
        onConfirm={() => setDialog(false)}
        onCancel={() => setDialog(false)}
      />
    </SafeAreaView>
  );
}
export default function Gallery() {
  const [mode, setMode] = useState<ThemeMode>('system');
  return (
    <SafeAreaProvider>
      <ThemeContext.Provider value={mode}>
        <View style={{ flex: 1 }}>
          <Examples />
          <SafeAreaView edges={['bottom']} style={{ padding: spacing.sm }}>
            <SegmentedControl
              label="Theme"
              value={mode}
              onChange={(value) => setMode(value as ThemeMode)}
              options={[
                { label: 'System', value: 'system' },
                { label: 'Light', value: 'light' },
                { label: 'Dark', value: 'dark' },
              ]}
            />
          </SafeAreaView>
        </View>
      </ThemeContext.Provider>
    </SafeAreaProvider>
  );
}
