import type { ReactElement } from 'react';
import {
  SectionList,
  View,
  type RefreshControlProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { spacing } from './tokens';

export type VirtualSection<T> = {
  key: string;
  header: ReactElement;
  data: readonly T[];
  footer?: ReactElement;
};

/** One page of rows renders up front; later rows mount only while near the viewport. */
export const VIRTUAL_INITIAL_ROWS = 20;

/**
 * Productivity list shell: screen chrome scrolls with the list, while loaded
 * rows are virtualized. Server order and grouping come from the caller.
 */
export function VirtualSections<T>({
  testID,
  sections,
  keyExtractor,
  renderItem,
  header,
  footer,
  refreshControl,
  contentContainerStyle,
  automaticallyAdjustKeyboardInsets,
  keyboardDismissMode,
}: {
  automaticallyAdjustKeyboardInsets?: boolean;
  keyboardDismissMode?: 'none' | 'on-drag' | 'interactive';
  testID?: string;
  sections: readonly VirtualSection<T>[];
  keyExtractor: (item: T) => string;
  renderItem: (item: T) => ReactElement;
  header: ReactElement;
  footer: ReactElement;
  refreshControl?: ReactElement<RefreshControlProps>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <SectionList
      testID={testID}
      sections={sections.map((section) => ({
        ...section,
        data: section.data as T[],
      }))}
      keyExtractor={keyExtractor}
      renderItem={({ item }) => renderItem(item)}
      renderSectionHeader={({ section }) => (
        <View style={{ paddingTop: spacing.lg, paddingBottom: spacing.sm }}>
          {section.header}
        </View>
      )}
      renderSectionFooter={({ section }) =>
        section.footer ? (
          <View style={{ paddingTop: spacing.sm }}>{section.footer}</View>
        ) : null
      }
      ItemSeparatorComponent={RowGap}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      refreshControl={refreshControl}
      contentContainerStyle={contentContainerStyle}
      stickySectionHeadersEnabled={false}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets={automaticallyAdjustKeyboardInsets}
      keyboardDismissMode={keyboardDismissMode}
      initialNumToRender={VIRTUAL_INITIAL_ROWS}
      maxToRenderPerBatch={10}
      windowSize={7}
      removeClippedSubviews={false}
    />
  );
}

function RowGap() {
  return <View style={{ height: spacing.sm }} />;
}
