import { useLocalSearchParams } from 'expo-router';
import { ActivityScreen } from '../../../../features/activity/ActivityScreen';
import { parseResourceId } from '../../../../navigation/routes';

export default function WorkspaceActivity() {
  const { workspaceId } = useLocalSearchParams();
  return (
    <ActivityScreen
      scope="workspace"
      id={typeof workspaceId === 'string' ? parseResourceId(workspaceId) : null}
    />
  );
}
