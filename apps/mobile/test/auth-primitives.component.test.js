/* global test, expect */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AuthFrame } from '../src/features/auth/components';
import { PasswordField } from '../src/ui';
test('native auth composition uses official branding, scalable fields and an accessible inline eye', async () => {
  await render(
    <AuthFrame title="Welcome back" subtitle="Sign in to your Kanvexa account">
      <PasswordField
        inlineToggle
        label="Password"
        value="draft"
        onChangeText={() => {}}
      />
    </AuthFrame>,
  );
  expect(screen.getByLabelText('Kanvexa logo')).toBeTruthy();
  expect(screen.getByRole('header', { name: 'Welcome back' })).toBeTruthy();
  expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(true);
  await fireEvent.press(screen.getByRole('button', { name: 'Show password' }));
  expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(false);
  expect(screen.getByRole('button', { name: 'Hide password' })).toBeTruthy();
});
