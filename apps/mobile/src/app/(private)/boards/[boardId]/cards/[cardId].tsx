import { useLocalSearchParams } from 'expo-router';
import { CardDetailScreen } from '../../../../../features/cards/detail/CardDetailScreen';
import { parseResourceId } from '../../../../../navigation/routes';
export default function Card() {
  const params = useLocalSearchParams<{
    boardId?: string | string[];
    cardId?: string | string[];
  }>();
  return (
    <CardDetailScreen
      boardId={
        typeof params.boardId === 'string'
          ? parseResourceId(params.boardId)
          : null
      }
      cardId={
        typeof params.cardId === 'string'
          ? parseResourceId(params.cardId)
          : null
      }
    />
  );
}
