/* global jest, test, expect */
import { fireEvent, render, screen } from '@testing-library/react-native';
import BoardsGallery from '../gallery/navigation/app/(private)/(tabs)/boards';
import HomeGallery from '../gallery/navigation/app/(private)/(tabs)/home';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

test.each([
  [HomeGallery, 'Home', 'Search', '/search'],
  [BoardsGallery, 'Boards', 'Search', '/search'],
])(
  'gallery scaffold mounts without production providers',
  async (Route, title, action, path) => {
    await render(<Route />);
    expect(screen.getByRole('header', { name: title })).toBeTruthy();
    expect(screen.getByText('This feature is coming soon.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: action }));
    expect(mockPush).toHaveBeenLastCalledWith(path);
  },
);
