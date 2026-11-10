/* global jest, test, expect */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import {
  Avatar,
  AvatarStack,
  Button,
  Checkbox,
  FilterChip,
  ListRow,
  LoadingState,
  PasswordField,
  palettes,
  PreferenceSwitch,
  ProgressBar,
  SearchField,
  SegmentedControl,
  Skeleton,
  StatTile,
  TextField,
  UnsavedChangesPrompt,
} from '../src/ui';
import { ConfirmDialog, BottomSheet } from '../src/ui';

function modalHost(node) {
  if (typeof node !== 'object' || node === null) return undefined;
  if (typeof node.props?.onRequestClose === 'function') return node;
  return node.children.map(modalHost).find(Boolean);
}

function imageHost(node) {
  if (typeof node !== 'object' || node === null) return undefined;
  if (typeof node.props?.onError === 'function') return node;
  return node.children.map(imageHost).find(Boolean);
}

test('avatar retries when its image source changes after an error', async () => {
  const first = { uri: 'https://example.invalid/first.png' };
  const second = { uri: 'https://example.invalid/second.png' };
  const { container, rerender } = await render(
    <Avatar name="Example Person" source={first} />,
  );
  await fireEvent(imageHost(container), 'error');
  expect(screen.getByText('EP')).toBeTruthy();
  await rerender(<Avatar name="Example Person" source={second} />);
  expect(imageHost(container).props.source).toEqual(second);
});

test('disabled and loading buttons expose state and do not call their action', async () => {
  const action = jest.fn();
  await render(
    <>
      <Button label="Disabled" disabled onPress={action} />
      <Button label="Saving" loading onPress={action} />
    </>,
  );
  expect(
    screen.getByRole('button', { name: 'Disabled' }).props.accessibilityState,
  ).toMatchObject({ disabled: true });
  expect(
    screen.getByRole('button', { name: 'Saving' }).props.accessibilityState,
  ).toMatchObject({ disabled: true, busy: true });
  await fireEvent.press(screen.getByRole('button', { name: 'Disabled' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Saving' }));
  expect(action).not.toHaveBeenCalled();
});

test('row action and trailing action remain separate accessible controls', async () => {
  const open = jest.fn();
  const trailing = jest.fn();
  await render(
    <ListRow
      title="Example"
      accessibilityLabel="Open example"
      onPress={open}
      trailing={
        <Button label="More options" variant="secondary" onPress={trailing} />
      }
    />,
  );
  const row = screen.getByRole('button', { name: 'Open example' });
  const action = screen.getByRole('button', { name: 'More options' });
  const contains = (node, target) =>
    typeof node === 'object' &&
    node !== null &&
    (node === target || node.children.some((child) => contains(child, target)));
  expect(contains(row, action)).toBe(false);
  await fireEvent.press(action);
  expect(trailing).toHaveBeenCalledTimes(1);
  expect(open).not.toHaveBeenCalled();
  await fireEvent.press(row);
  expect(open).toHaveBeenCalledTimes(1);
});

test('disabled row does not disable its independent trailing control', async () => {
  const open = jest.fn();
  const trailing = jest.fn();
  await render(
    <ListRow
      title="Example"
      disabled
      onPress={open}
      trailing={
        <Button label="More options" variant="secondary" onPress={trailing} />
      }
    />,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Example' }));
  await fireEvent.press(screen.getByRole('button', { name: 'More options' }));
  expect(open).not.toHaveBeenCalled();
  expect(trailing).toHaveBeenCalledTimes(1);
});

test('icon button exposes its label and activates its action', async () => {
  const action = jest.fn();
  await render(
    <Button
      variant="icon"
      label="Open options"
      icon={<View />}
      onPress={action}
    />,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Open options' }));
  expect(action).toHaveBeenCalledTimes(1);
});

test('button exposes a visible focus treatment', async () => {
  await render(<Button label="Focus example" onPress={() => {}} />);
  const control = screen.getByRole('button', { name: 'Focus example' });
  const original = StyleSheet.flatten(control.props.style).borderColor;
  await fireEvent(control, 'focus');
  expect(
    StyleSheet.flatten(
      screen.getByRole('button', { name: 'Focus example' }).props.style,
    ).borderColor,
  ).not.toBe(original);
});

test('controlled field and password visibility preserve their text and error', async () => {
  function Form() {
    const [value, setValue] = useState('');
    return (
      <>
        <TextField
          label="Name"
          value={value}
          onChangeText={setValue}
          error="Name is required"
        />
        <PasswordField label="Password" value={value} onChangeText={setValue} />
      </>
    );
  }
  await render(<Form />);
  await fireEvent.changeText(screen.getByLabelText('Name'), 'Example');
  expect(screen.getByLabelText('Password').props.value).toBe('Example');
  expect(screen.getByText('Name is required')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Show password' }));
  expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(false);
  expect(screen.getByLabelText('Password').props.value).toBe('Example');
});

test('password visibility and grouped loading labels can be localized', async () => {
  await render(
    <>
      <PasswordField
        label="Mật khẩu"
        value="example"
        showPasswordLabel="Hiện mật khẩu"
        hidePasswordLabel="Ẩn mật khẩu"
      />
      <AvatarStack
        people={[{ name: 'An' }, { name: 'Bình' }]}
        accessibilityLabel="2 người: An, Bình"
      />
      <Skeleton label="Đang tải" />
    </>,
  );
  expect(screen.getByLabelText('2 người: An, Bình')).toBeTruthy();
  expect(screen.getByRole('progressbar', { name: 'Đang tải' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Hiện mật khẩu' }));
  expect(screen.getByLabelText('Mật khẩu').props.secureTextEntry).toBe(false);
  await fireEvent.press(screen.getByRole('button', { name: 'Ẩn mật khẩu' }));
  expect(screen.getByLabelText('Mật khẩu').props.secureTextEntry).toBe(true);
  expect(screen.getByLabelText('Mật khẩu').props.value).toBe('example');
});

test('selection controls expose and update their accessible states', async () => {
  const action = jest.fn();
  await render(
    <>
      <FilterChip label="Filter" selected disabled onPress={action} />
      <SegmentedControl
        label="Options"
        value="a"
        onChange={action}
        options={[
          { label: 'First', value: 'a' },
          { label: 'Second', value: 'b' },
          { label: 'Unavailable option', value: 'c', disabled: true },
        ]}
      />
    </>,
  );
  expect(
    screen.getByRole('button', { name: 'Filter' }).props.accessibilityState,
  ).toMatchObject({ selected: true, disabled: true });
  expect(
    screen.getByRole('radio', { name: 'First' }).props.accessibilityState,
  ).toMatchObject({ checked: true });
  expect(screen.getByText('✓ Filter')).toBeTruthy();
  expect(screen.getByText('✓ First')).toBeTruthy();
  expect(screen.getByText('Second')).toBeTruthy();
  await fireEvent.press(
    screen.getByRole('radio', { name: 'Unavailable option' }),
  );
  expect(action).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('radio', { name: 'Second' }));
  expect(action).toHaveBeenCalledWith('b');
});

test('sheet Back dismisses, while a pending confirmation cannot be dismissed', async () => {
  const dismiss = jest.fn();
  const confirm = jest.fn();
  const { unmount, container } = await render(
    <BottomSheet visible title="Sheet" onDismiss={dismiss}>
      <TextField label="Field" />
    </BottomSheet>,
  );
  await fireEvent(modalHost(container), 'requestClose');
  expect(dismiss).toHaveBeenCalledTimes(1);
  await unmount();
  const confirmation = await render(
    <ConfirmDialog
      visible
      title="Confirm"
      message="Example"
      confirmLabel="Delete"
      destructive
      loading
      onConfirm={confirm}
      onCancel={dismiss}
    />,
  );
  await fireEvent(modalHost(confirmation.container), 'requestClose');
  expect(dismiss).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole('button', { name: 'Delete' }).props.accessibilityState,
  ).toMatchObject({ disabled: true, busy: true });
  await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Dismiss' }));
  expect(confirm).not.toHaveBeenCalled();
  expect(dismiss).toHaveBeenCalledTimes(1);
  await confirmation.rerender(
    <ConfirmDialog
      visible
      title="Confirm"
      message="Example"
      confirmLabel="Delete"
      destructive
      onConfirm={confirm}
      onCancel={dismiss}
    />,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Dismiss' }));
  await fireEvent(modalHost(confirmation.container), 'requestClose');
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(dismiss).toHaveBeenCalledTimes(4);
});

test('unsaved prompt distinguishes discard from keep editing and Back', async () => {
  const discard = jest.fn();
  const keep = jest.fn();
  const { container } = await render(
    <UnsavedChangesPrompt visible onDiscard={discard} onKeepEditing={keep} />,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Keep editing' }));
  expect(keep).toHaveBeenCalledTimes(1);
  expect(discard).not.toHaveBeenCalled();
  await fireEvent(modalHost(container), 'requestClose');
  expect(keep).toHaveBeenCalledTimes(2);
  await fireEvent.press(screen.getByRole('button', { name: 'Discard' }));
  expect(discard).toHaveBeenCalledTimes(1);
  expect(keep).toHaveBeenCalledTimes(2);
});

test('unsaved prompt accepts localized visible and dismissal labels', async () => {
  const discard = jest.fn();
  const keep = jest.fn();
  await render(
    <UnsavedChangesPrompt
      visible
      title="Bỏ thay đổi?"
      message="Các thay đổi chưa lưu sẽ bị mất."
      discardLabel="Bỏ thay đổi"
      keepEditingLabel="Tiếp tục chỉnh sửa"
      dismissLabel="Đóng hộp thoại"
      onDiscard={discard}
      onKeepEditing={keep}
    />,
  );
  expect(screen.getByRole('header', { name: 'Bỏ thay đổi?' })).toBeTruthy();
  expect(screen.getByText('Các thay đổi chưa lưu sẽ bị mất.')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Đóng hộp thoại' }));
  await fireEvent.press(
    screen.getByRole('button', { name: 'Tiếp tục chỉnh sửa' }),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Bỏ thay đổi' }));
  expect(keep).toHaveBeenCalledTimes(2);
  expect(discard).toHaveBeenCalledTimes(1);
});

test('preference switch reports its value and blocks changes when disabled', async () => {
  const change = jest.fn();
  const { rerender } = await render(
    <PreferenceSwitch
      label="Preference"
      value={false}
      onValueChange={change}
    />,
  );
  const control = screen.getByLabelText('Preference');
  expect(control.props.value).toBe(false);
  await fireEvent(control, 'valueChange', true);
  expect(change).toHaveBeenCalledWith(true);
  await rerender(
    <PreferenceSwitch
      label="Preference"
      value
      disabled
      onValueChange={change}
    />,
  );
  const disabled = screen.getByLabelText('Preference');
  expect(disabled.props.value).toBe(true);
  expect(disabled.props.disabled).toBe(true);
  await fireEvent(disabled, 'valueChange', false);
  expect(change).toHaveBeenCalledTimes(1);
});

test('checkbox reports its state and progress exposes a bounded value', async () => {
  const change = jest.fn();
  await render(
    <>
      <Checkbox
        label="Example checkbox"
        checked={false}
        onValueChange={change}
      />
      <Checkbox
        label="Disabled checkbox"
        checked
        disabled
        onValueChange={change}
      />
      <ProgressBar label="Example progress" value={125} />
      <LoadingState label="Loading example" />
      <Skeleton />
    </>,
  );
  const checkbox = screen.getByRole('checkbox', { name: 'Example checkbox' });
  expect(checkbox.props.accessibilityState).toMatchObject({
    checked: false,
    disabled: false,
  });
  await fireEvent.press(checkbox);
  expect(change).toHaveBeenCalledWith(true);
  await fireEvent.press(
    screen.getByRole('checkbox', { name: 'Disabled checkbox' }),
  );
  expect(change).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole('progressbar', { name: 'Example progress' }).props
      .accessibilityValue,
  ).toEqual({ min: 0, max: 100, now: 100 });
  expect(
    screen.getByRole('progressbar', { name: 'Loading example' }),
  ).toBeTruthy();
  expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeTruthy();
});

test('search field keeps input and trailing action independently accessible', async () => {
  const clear = jest.fn();
  const update = jest.fn();
  await render(
    <SearchField
      label="Search"
      value="example"
      onChangeText={update}
      error="Example error"
      leading={<View />}
      trailing={
        <Button label="Clear search" variant="secondary" onPress={clear} />
      }
    />,
  );
  const input = screen.getByLabelText('Search');
  expect(input.props.value).toBe('example');
  expect(input.props.accessibilityHint).toBe('Example error');
  await fireEvent.changeText(input, 'changed');
  expect(update).toHaveBeenCalledWith('changed');
  await fireEvent.press(screen.getByRole('button', { name: 'Clear search' }));
  expect(clear).toHaveBeenCalledTimes(1);
});

test('invalid input retains error while exposing visible focus and blur', async () => {
  await render(<TextField label="Name" error="Name is required" />);
  const input = screen.getByLabelText('Name');
  const frameColor = () =>
    StyleSheet.flatten(screen.getByLabelText('Name').parent.props.style)
      .borderColor;
  expect(frameColor()).toBe(palettes.light.danger);
  await fireEvent(input, 'focus');
  expect(frameColor()).toBe(palettes.light.focus);
  expect(screen.getByText('Name is required')).toBeTruthy();
  expect(screen.getByLabelText('Name').props.accessibilityHint).toBe(
    'Name is required',
  );
  await fireEvent(screen.getByLabelText('Name'), 'blur');
  expect(frameColor()).toBe(palettes.light.danger);
});

test('input and secondary button use the visible control border', async () => {
  await render(
    <>
      <TextField label="Example input" />
      <Button label="Secondary" variant="secondary" onPress={() => {}} />
    </>,
  );
  expect(
    StyleSheet.flatten(
      screen.getByLabelText('Example input').parent.props.style,
    ).borderColor,
  ).toBe(palettes.light.controlBorder);
  expect(
    StyleSheet.flatten(
      screen.getByRole('button', { name: 'Secondary' }).props.style,
    ).borderColor,
  ).toBe(palettes.light.controlBorder);
});

test('avatar stack exposes the count and names while retaining initials fallbacks', async () => {
  await render(
    <AvatarStack
      people={[{ name: 'Example Person' }, { name: 'Another Person' }]}
    />,
  );
  expect(
    screen.getByLabelText('2 people: Example Person, Another Person'),
  ).toBeTruthy();
  expect(screen.getByText('EP')).toBeTruthy();
  expect(screen.getByText('AP')).toBeTruthy();
});

test('stat values use tabular numerals while preserving their text', async () => {
  await render(<StatTile label="Example count" value="12" />);
  const value = screen.getByText('12');
  expect(StyleSheet.flatten(value.props.style).fontVariant).toContain(
    'tabular-nums',
  );
});
