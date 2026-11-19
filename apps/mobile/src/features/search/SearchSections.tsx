import type {
  GlobalSearchItem,
  GlobalSearchResults,
  GlobalSearchType,
} from '@kanban/shared';
import { Image, Pressable, Text, View } from 'react-native';
import workspaceIcon from '../../../assets/workspace-icons/users.png';
import boardIcon from '../../../assets/navigation/boards.png';
import cardIcon from '../../../assets/workspace-icons/layers.png';
import { Button, Surface, spacing, typography, useTheme } from '../../ui';
import { searchGroups, type SearchGroupName } from './input';
import { searchCollection } from './queries';

export const searchLabels = {
  all: 'All',
  workspaces: 'Workspaces',
  boards: 'Boards',
  cards: 'Cards',
} as const;
const icons = { workspaces: workspaceIcon, boards: boardIcon, cards: cardIcon };

export function SearchSections({
  pages,
  type,
  disabled,
  opening,
  open,
  viewAll,
}: {
  pages: readonly GlobalSearchResults[];
  type: GlobalSearchType;
  disabled: boolean;
  opening?: string;
  open: (item: GlobalSearchItem) => void;
  viewAll: (type: SearchGroupName) => void;
}) {
  const c = useTheme();
  return searchGroups
    .filter((group) => type === 'all' || group === type)
    .map((group) => {
      const latest = pages.at(-1)?.groups[group];
      if (!latest?.total) return null;
      const rows = searchCollection(pages, group);
      return (
        <View key={group} style={{ gap: spacing.sm }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
            }}
          >
            <Image
              source={icons[group]}
              accessible={false}
              style={{ width: 24, height: 24, tintColor: c.primary }}
            />
            <Text
              accessibilityRole="header"
              style={[typography.section, { color: c.text, flex: 1 }]}
            >
              {searchLabels[group]} · {latest.total}
            </Text>
          </View>
          {rows.map((row) => {
            const context =
              row.type === 'workspace'
                ? ''
                : row.type === 'card'
                  ? [row.workspaceName, row.boardName]
                      .filter(Boolean)
                      .join(' · ')
                  : (row.workspaceName ?? '');
            const key = row.type + ':' + row.id;
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={`Open ${row.title}${context ? ', ' + context : ''}`}
                accessibilityHint={
                  row.subtitle && row.subtitle !== context
                    ? row.subtitle
                    : undefined
                }
                accessibilityState={{ disabled, busy: opening === key }}
                disabled={disabled}
                onPress={() => open(row)}
                style={({ pressed }) => ({
                  opacity: pressed ? 0.7 : 1,
                  minHeight: 48,
                })}
              >
                <Surface>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.sm,
                    }}
                  >
                    <View style={{ flex: 1, gap: spacing.xs }}>
                      <Text style={[typography.strong, { color: c.text }]}>
                        {row.title}
                      </Text>
                      {!!context && (
                        <Text
                          style={[
                            typography.supporting,
                            { color: c.textSecondary },
                          ]}
                        >
                          {context}
                        </Text>
                      )}
                      {!!row.subtitle && row.subtitle !== context && (
                        <Text
                          style={[
                            typography.supporting,
                            { color: c.textSecondary },
                          ]}
                        >
                          {row.subtitle}
                        </Text>
                      )}
                    </View>
                    <Text accessible={false} style={{ color: c.textSecondary }}>
                      ›
                    </Text>
                  </View>
                </Surface>
              </Pressable>
            );
          })}
          {type === 'all' && latest.hasMore && (
            <Button
              label={'View all ' + searchLabels[group]}
              variant="secondary"
              disabled={disabled}
              onPress={() => viewAll(group)}
            />
          )}
        </View>
      );
    });
}
