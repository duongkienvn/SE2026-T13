export const tabs = [
  { name: 'home', label: 'Home', sf: 'house', selectedSf: 'house.fill' },
  {
    name: 'tasks',
    label: 'My Tasks',
    sf: 'checkmark.circle',
    selectedSf: 'checkmark.circle.fill',
  },
  {
    name: 'boards',
    label: 'Boards',
    sf: 'rectangle.split.3x1',
    selectedSf: 'rectangle.split.3x1.fill',
  },
  { name: 'inbox', label: 'Inbox', sf: 'bell', selectedSf: 'bell.fill' },
] as const;
