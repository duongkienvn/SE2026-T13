/* global jest, test, expect */
import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';
import { Button, TextField } from '../src/ui';
import { renderNative } from './render-native';

test.each(['light', 'dark'])(
  'native harness renders accessible states in %s',
  async (theme) => {
    const press = jest.fn();
    await renderNative(
      <>
        <TextField label="Example" error="Required" />
        <Button label="Save" loading onPress={press} />
      </>,
      { theme },
    );
    expect(screen.getByLabelText('Example').props.accessibilityHint).toBe(
      'Required',
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.props.accessibilityState).toMatchObject({
      disabled: true,
      busy: true,
    });
    await fireEvent.press(button);
    expect(press).not.toHaveBeenCalled();
  },
);
