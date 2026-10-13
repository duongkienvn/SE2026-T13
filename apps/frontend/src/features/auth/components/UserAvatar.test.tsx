import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UserAvatar } from './UserAvatar';

describe('UserAvatar', () => {
  it('shows initials when there is no avatar URL', () => {
    render(
      <UserAvatar user={{ displayName: 'Ada Lovelace', avatarUrl: null }} />,
    );
    expect(screen.getByText('AL')).toBeTruthy();
  });

  it('uses the first two letters of a single-word name', () => {
    render(<UserAvatar user={{ displayName: 'grace', avatarUrl: null }} />);
    expect(screen.getByText('GR')).toBeTruthy();
  });

  it('falls back to initials when the image fails to load', () => {
    const { container } = render(
      <UserAvatar
        user={{
          displayName: 'Ada Lovelace',
          avatarUrl: 'https://images.example/broken.png',
        }}
      />,
    );
    const image = container.querySelector('img')!;
    expect(image.getAttribute('src')).toBe('https://images.example/broken.png');

    fireEvent.error(image);

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('AL')).toBeTruthy();
  });
});
