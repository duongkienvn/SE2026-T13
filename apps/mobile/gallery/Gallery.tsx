import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Keyboard, ScrollView, Text, View } from 'react-native';
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
  Checkbox,
  ConfirmDialog,
  DueChip,
  EmptyState,
  ErrorState,
  OfflineState,
  FilterChip,
  FormFooter,
  LoadingState,
  LabelChip,
  NotificationRow,
  PasswordField,
  PreferenceSwitch,
  ProgressBar,
  ScreenHeader,
  SearchField,
  SectionHeader,
  SegmentedControl,
  Separator,
  Skeleton,
  Snackbar,
  StatTile,
  StatusChip,
  TaskRow,
  TextField,
  UnsavedChangesPrompt,
  ThemeContext,
  type ThemeMode,
  palettes,
  spacing,
  typography,
  useTheme,
} from '../src/ui';

function Examples() {
  const c = useTheme();
  const [text, setText] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [checked, setChecked] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState(false);
  const [unsavedPrompt, setUnsavedPrompt] = useState(false);
  const [promptFeedback, setPromptFeedback] = useState('');
  const [selected, setSelected] = useState('one');
  const [rowFeedback, setRowFeedback] = useState('');
  useEffect(() => {
    if (!pendingConfirmation) return;
    const timer = setTimeout(() => setPendingConfirmation(false), 20000);
    return () => clearTimeout(timer);
  }, [pendingConfirmation]);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      <StatusBar
        style={c.background === palettes.dark.background ? 'light' : 'dark'}
      />
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
          label="Preview pending confirmation (20 seconds)"
          variant="secondary"
          onPress={() => {
            setPendingConfirmation(true);
            setDialog(true);
          }}
        />
        <Button
          label="Open unsaved changes prompt"
          variant="secondary"
          onPress={() => setUnsavedPrompt(true)}
        />
        {promptFeedback ? <Snackbar message={promptFeedback} /> : null}
        <Button
          label="Destructive example"
          variant="destructive"
          onPress={() => setDialog(true)}
        />
        <Button
          variant="icon"
          label="Open example options"
          onPress={() => setDialog(true)}
          icon={
            <View
              accessibilityElementsHidden
              importantForAccessibility="no"
              style={{
                width: 20,
                height: 20,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <View style={{ width: 18, height: 2, backgroundColor: c.text }} />
              <View
                style={{
                  position: 'absolute',
                  width: 2,
                  height: 18,
                  backgroundColor: c.text,
                }}
              />
            </View>
          }
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
          leading={
            <Text
              accessible={false}
              style={[typography.section, { color: c.textSecondary }]}
            >
              ⌕
            </Text>
          }
          trailing={
            text ? (
              <Button
                label="Clear search"
                variant="icon"
                icon={
                  <Text
                    allowFontScaling={false}
                    style={{ color: c.text, fontSize: 24 }}
                  >
                    ×
                  </Text>
                }
                onPress={() => setText('')}
              />
            ) : undefined
          }
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
            {
              label:
                'Lựa chọn có tên rất dài để kiểm tra cách xuống dòng trên màn hình nhỏ',
              value: 'two',
            },
          ]}
        />
        <Checkbox
          label="Example checkbox"
          checked={checked}
          onValueChange={setChecked}
        />
        <ProgressBar label="Example progress" value={60} />
        <PreferenceSwitch
          label="Example preference"
          value={enabled}
          onValueChange={setEnabled}
        />
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}
        >
          <FilterChip
            label="Bộ lọc có tên rất dài để kiểm tra cách xuống dòng trên màn hình nhỏ"
            selected={enabled}
            onPress={() => setEnabled(!enabled)}
          />
          <StatusChip label="Success" tone="success" />
          <LabelChip label="Label example" />
          <DueChip label="Due example" tone="warning" />
        </View>
        <SectionHeader title="People and content" />
        <Separator />
        <Avatar name="Example Person" />
        <AvatarStack
          people={[{ name: 'Example Person' }, { name: 'Another Person' }]}
        />
        <StatTile label="Example count" value="12" />
        <BoardTile title="Board title example" subtitle="Supporting text" />
        <BoardRow
          title="Ví dụ tên bảng rất dài để kiểm tra cách xuống dòng trên màn hình nhỏ"
          subtitle="Thông tin bổ sung dài cho trường hợp kiểm tra giao diện"
          onPress={() => setRowFeedback('Row action selected')}
          trailing={
            <Button
              label="Row options"
              variant="secondary"
              onPress={() => setRowFeedback('Trailing action selected')}
            />
          }
        />
        {rowFeedback ? <Snackbar message={rowFeedback} /> : null}
        <CardPreview title="Ví dụ tiêu đề thẻ rất dài để kiểm tra cách hiển thị trên màn hình nhỏ">
          <Text style={[typography.body, { color: c.textSecondary }]}>
            Supporting text
          </Text>
        </CardPreview>
        <TaskRow
          title="Ví dụ tên công việc rất dài để kiểm tra cách xuống dòng"
          subtitle="Thông tin bổ sung dài cho component thử nghiệm"
        />
        <NotificationRow
          title="Ví dụ thông báo rất dài để kiểm tra cách hiển thị"
          subtitle="Nội dung phụ dài cho component thử nghiệm"
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
      <UnsavedChangesPrompt
        visible={unsavedPrompt}
        onDiscard={() => {
          setUnsavedPrompt(false);
          setPromptFeedback('Discard selected');
        }}
        onKeepEditing={() => {
          setUnsavedPrompt(false);
          setPromptFeedback('Keep editing selected');
        }}
      />
      <ConfirmDialog
        visible={dialog}
        title="Example confirmation"
        message={
          pendingConfirmation
            ? 'Pending example: controls unlock after 20 seconds.'
            : 'This only closes the example.'
        }
        confirmLabel="Confirm"
        destructive
        loading={pendingConfirmation}
        onConfirm={() => setDialog(false)}
        onCancel={() => setDialog(false)}
      />
    </SafeAreaView>
  );
}
export default function Gallery() {
  const [mode, setMode] = useState<ThemeMode>('system');
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () =>
      setKeyboardVisible(true),
    );
    const hide = Keyboard.addListener('keyboardDidHide', () =>
      setKeyboardVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return (
    <SafeAreaProvider>
      <ThemeContext.Provider value={mode}>
        <View style={{ flex: 1 }}>
          <Examples />
          {!keyboardVisible && <ThemeSelector mode={mode} onChange={setMode} />}
        </View>
      </ThemeContext.Provider>
    </SafeAreaProvider>
  );
}

function ThemeSelector({
  mode,
  onChange,
}: {
  mode: ThemeMode;
  onChange: (mode: ThemeMode) => void;
}) {
  const c = useTheme();
  return (
    <SafeAreaView
      edges={['bottom']}
      style={{ padding: spacing.sm, backgroundColor: c.background }}
    >
      <SegmentedControl
        label="Theme"
        value={mode}
        onChange={(value) => onChange(value as ThemeMode)}
        options={[
          { label: 'System', value: 'system' },
          { label: 'Light', value: 'light' },
          { label: 'Dark', value: 'dark' },
        ]}
      />
    </SafeAreaView>
  );
}
