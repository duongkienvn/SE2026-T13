import { act, fireEvent, screen } from '@testing-library/react-native';

/** Drive a virtualized list like a user scrolling to an offset (Jest has no layout pass). */
export async function scrollList(testID, y = 1e6, rowHeight = 80) {
  const list = screen.getByTestId(testID);
  await act(async () => {
    fireEvent(list, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 800 } },
    });
    fireEvent(list, 'contentSizeChange', 390, y + 800 + rowHeight);
    fireEvent.scroll(list, {
      nativeEvent: {
        contentOffset: { x: 0, y },
        contentSize: { width: 390, height: y + 800 + rowHeight },
        layoutMeasurement: { width: 390, height: 800 },
      },
    });
  });
}
