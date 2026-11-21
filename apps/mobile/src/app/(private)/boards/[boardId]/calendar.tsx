import { useLocalSearchParams } from 'expo-router';
import { CalendarMonthScreen } from '../../../../features/calendar/CalendarMonthScreen';
import { parseResourceId } from '../../../../navigation/routes';

export default function Calendar() {
  const { boardId } = useLocalSearchParams();
  return (
    <CalendarMonthScreen
      boardId={typeof boardId === 'string' ? parseResourceId(boardId) : null}
    />
  );
}
