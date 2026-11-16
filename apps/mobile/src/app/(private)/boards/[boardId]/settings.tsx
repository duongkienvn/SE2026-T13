import { useLocalSearchParams } from 'expo-router';
import { BoardSettingsScreen } from '../../../../features/boards/BoardSettingsScreen';
import { parseResourceId } from '../../../../navigation/routes';

export default function BoardSettings() {
  const { boardId } = useLocalSearchParams();
  return (
    <BoardSettingsScreen
      boardId={typeof boardId === 'string' ? parseResourceId(boardId) : null}
    />
  );
}
