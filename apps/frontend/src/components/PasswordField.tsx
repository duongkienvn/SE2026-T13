import { useState } from 'react';
import { EyeIcon, EyeOffIcon, LockIcon } from './icons';
import { TextField, type TextFieldProps } from './TextField';

type PasswordFieldProps = Omit<TextFieldProps, 'type' | 'icon' | 'trailing'>;

export function PasswordField(props: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <TextField
      {...props}
      type={visible ? 'text' : 'password'}
      icon={<LockIcon />}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          className={`grid place-items-center rounded-md text-lg text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-primary ${props.appearance === 'auth' ? 'auth-entry-reveal size-11' : 'size-8'}`}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      }
    />
  );
}
