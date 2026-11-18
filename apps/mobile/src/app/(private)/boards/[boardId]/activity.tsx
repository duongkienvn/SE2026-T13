import { useLocalSearchParams } from 'expo-router';
import { ActivityScreen } from '../../../../features/activity/ActivityScreen';
import { parseResourceId } from '../../../../navigation/routes';

export default function BoardActivity() {
  const { boardId } = useLocalSearchParams();
  return (
    <ActivityScreen
      scope="board"
      id={typeof boardId === 'string' ? parseResourceId(boardId) : null}
    />
  );
}
