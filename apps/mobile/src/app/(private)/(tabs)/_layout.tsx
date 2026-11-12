import { NativeTabs } from 'expo-router/native-tabs';
import { useTheme } from '../../../ui';
import { tabs } from '../../../navigation/tabs';
import homeIcon from '../../../../assets/navigation/home.png';
import homeSelectedIcon from '../../../../assets/navigation/home-selected.png';
import tasksIcon from '../../../../assets/navigation/tasks.png';
import tasksSelectedIcon from '../../../../assets/navigation/tasks-selected.png';
import boardsIcon from '../../../../assets/navigation/boards.png';
import boardsSelectedIcon from '../../../../assets/navigation/boards-selected.png';
import inboxIcon from '../../../../assets/navigation/inbox.png';
import inboxSelectedIcon from '../../../../assets/navigation/inbox-selected.png';

const androidIcons = {
  home: { default: homeIcon, selected: homeSelectedIcon },
  tasks: { default: tasksIcon, selected: tasksSelectedIcon },
  boards: { default: boardsIcon, selected: boardsSelectedIcon },
  inbox: { default: inboxIcon, selected: inboxSelectedIcon },
} as const;

export default function TabsLayout() {
  const c = useTheme();
  return (
    <NativeTabs
      tintColor={c.primary}
      iconColor={{ default: c.textSecondary, selected: c.primary }}
      labelStyle={{
        default: { color: c.textSecondary, fontSize: 12, fontWeight: '600' },
        selected: { color: c.primary, fontSize: 12, fontWeight: '600' },
      }}
      backgroundColor={c.surface}
      labelVisibilityMode="labeled"
      disableIndicator
      minimizeBehavior="never"
    >
      {tabs.map(({ name, label, sf, selectedSf }) => (
        <NativeTabs.Trigger key={name} name={name}>
          <NativeTabs.Trigger.Label>{label}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            sf={{ default: sf, selected: selectedSf }}
            src={androidIcons[name]}
          />
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}
