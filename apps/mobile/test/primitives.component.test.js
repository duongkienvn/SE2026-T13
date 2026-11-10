/* global jest, test, expect */
import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import {
  Button,
  FilterChip,
  PasswordField,
  SegmentedControl,
  TextField,
} from '../src/ui';
import { ConfirmDialog, BottomSheet } from '../src/ui';

function modalHost(node) {
  if (typeof node !== 'object' || node === null) return undefined;
  if (typeof node.props?.onRequestClose === 'function') return node;
  return node.children.map(modalHost).find(Boolean);
}

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
  await fireEvent.press(
    screen.getByRole('radio', { name: 'Unavailable option' }),
  );
  expect(action).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('radio', { name: 'Second' }));
  expect(action).toHaveBeenCalledWith('b');
});

test('sheet Back dismisses, while a pending confirmation cannot be dismissed', async () => {
  const dismiss = jest.fn();
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
      onConfirm={jest.fn()}
      onCancel={dismiss}
    />,
  );
  await fireEvent(modalHost(confirmation.container), 'requestClose');
  expect(dismiss).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole('button', { name: 'Delete' }).props.accessibilityState,
  ).toMatchObject({ disabled: true, busy: true });
});
