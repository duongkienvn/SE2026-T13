import { useLocalSearchParams } from 'expo-router';
import { BoardDetailScreen } from '../../../../features/boards/BoardDetailScreen';
import { parseResourceId } from '../../../../navigation/routes';

export default function Board() {
  const { boardId } = useLocalSearchParams();
  return (
    <BoardDetailScreen
      boardId={typeof boardId === 'string' ? parseResourceId(boardId) : null}
    />
  );
}
