import { useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, TextField, spacing, typography, useTheme } from '../../../ui';
import {
  activeMention,
  changeText,
  insertMention,
  searchKey,
  type Candidate,
  type MentionDraft,
  type Selection,
} from './mentions';

export function MentionComposer({
  label,
  draft,
  onChange,
  candidates,
  disabled,
  membersLoading,
  memberError,
  retryMembers,
  moreMembers,
  loadMembers,
}: {
  label: string;
  draft: MentionDraft;
  onChange: (value: MentionDraft) => void;
  candidates: Candidate[];
  disabled: boolean;
  membersLoading: boolean;
  memberError?: string;
  retryMembers?: () => void;
  moreMembers: boolean;
  loadMembers: () => void;
}) {
  const c = useTheme();
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [selection, setSelection] = useState<Selection>({
    start: draft.text.length,
    end: draft.text.length,
  });
  const [forcedSelection, setForcedSelection] = useState<Selection>();
  const [height, setHeight] = useState(80);
  const [offset, setOffset] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const active = activeMention(draft, selection);
  const matches = active
    ? candidates.filter((member) =>
        searchKey(member.displayName).includes(searchKey(active.query)),
      )
    : [];
  const visible = matches.slice(offset, offset + 8);
  const choose = (member: Candidate) => {
    if (disabled) return;
    const value = insertMention(draft, selection, member);
    if (!value) return;
    onChange(value.draft);
    const caret = { start: value.caret, end: value.caret };
    setSelection(caret);
    setForcedSelection(caret);
    setOffset(0);
    setHighlight(0);
    input.current?.focus();
  };
  return (
    <View style={{ gap: spacing.sm }}>
      <TextField
        ref={input}
        label={label}
        value={draft.text}
        multiline
        editable={!disabled}
        hint="Type @ and select a Board member to mention them."
        placeholder="Write a comment…"
        textAlignVertical="top"
        scrollEnabled={height >= 200}
        selection={forcedSelection}
        onContentSizeChange={(event) =>
          setHeight(
            Math.max(80, Math.min(200, event.nativeEvent.contentSize.height)),
          )
        }
        style={{ minHeight: 80, height, maxHeight: 200, flex: 1 }}
        onChangeText={(text) => {
          onChange(changeText(draft, text));
          setForcedSelection(undefined);
          setOffset(0);
          setHighlight(0);
        }}
        onSelectionChange={(event) => {
          setSelection(event.nativeEvent.selection);
          setForcedSelection(undefined);
          setOffset(0);
          setHighlight(0);
        }}
        onKeyPress={(event) => {
          const { nativeEvent } = event;
          if (nativeEvent.key === 'ArrowDown')
            setHighlight((value) => Math.min(visible.length - 1, value + 1));
          if (nativeEvent.key === 'ArrowUp')
            setHighlight((value) => Math.max(0, value - 1));
          if (nativeEvent.key === 'Tab' && visible[highlight]) {
            event.preventDefault();
            choose(visible[highlight]);
          }
        }}
      />
      {draft.spans.length > 0 && (
        <Button
          label="Remove mention links"
          variant="link"
          disabled={disabled}
          onPress={() => onChange({ ...draft, spans: [] })}
        />
      )}
      {active && (
        <View
          accessibilityLabel="Board member suggestions"
          style={{ gap: spacing.sm }}
        >
          <Text
            accessibilityLiveRegion="polite"
            style={[typography.supporting, { color: c.textSecondary }]}
          >
            {membersLoading
              ? 'Loading Board members…'
              : (memberError ??
                (matches.length
                  ? `${matches.length} matching Board members loaded`
                  : 'No matching members loaded. You can keep @ as plain text.'))}
          </Text>
          {!memberError &&
            visible.map((member, index) => (
              <Button
                key={member.userId}
                label={`${member.displayName} · ${member.detail ?? member.userId}`}
                accessibilityLabel={`Mention ${member.displayName}, member ${member.userId}`}
                variant={index === highlight ? 'secondary' : 'link'}
                disabled={disabled || membersLoading}
                onPress={() => choose(member)}
              />
            ))}
          <View style={composerStyles.actions}>
            {offset > 0 && (
              <Button
                label="Previous matches"
                variant="link"
                onPress={() => {
                  setOffset((value) => Math.max(0, value - 8));
                  setHighlight(0);
                }}
              />
            )}
            {offset + 8 < matches.length && (
              <Button
                label="More matches"
                variant="link"
                onPress={() => {
                  setOffset((value) => value + 8);
                  setHighlight(0);
                }}
              />
            )}
            {moreMembers && (
              <Button
                label="Load more Board members"
                variant="link"
                disabled={disabled || membersLoading}
                onPress={loadMembers}
              />
            )}
            {retryMembers && (
              <Button
                label="Retry Board members"
                variant="link"
                disabled={disabled || membersLoading}
                onPress={retryMembers}
              />
            )}
          </View>
        </View>
      )}
    </View>
  );
}
export const composerStyles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
