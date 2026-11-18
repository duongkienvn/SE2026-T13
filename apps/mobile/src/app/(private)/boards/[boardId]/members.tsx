import { useLocalSearchParams } from 'expo-router';
import { BoardMembersScreen } from '../../../../features/boards/members/BoardMembersScreen';
import { parseResourceId } from '../../../../navigation/routes';

export default function BoardMembers() {
  const { boardId } = useLocalSearchParams();
  return (
    <BoardMembersScreen
      boardId={typeof boardId === 'string' ? parseResourceId(boardId) : null}
    />
  );
}
