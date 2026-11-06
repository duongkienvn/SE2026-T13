export const STARTER_TEMPLATE_VERSION = 1;
export const STARTER_BOARD_NAME = 'Welcome to Kanvexa';
export const STARTER_BOARD_DESCRIPTION =
  'A sample workspace to help you discover Kanvexa. Explore the cards, try the features, and customize everything to make it yours.';
export const STARTER_LABELS = {
  'Getting Started': '#615CF7',
  Tutorial: '#0E7490',
  Board: '#2563EB',
  Tips: '#CA8A04',
  Workspace: '#9333EA',
  Planning: '#15803D',
  'High Priority': '#DC2626',
  'In Progress': '#EA580C',
  Completed: '#15803D',
} as const;
interface StarterCard {
  title: string;
  description: string;
  labels: readonly (keyof typeof STARTER_LABELS)[];
  assigned?: boolean;
  startDay?: number;
  dueDay?: number;
  checklist: { title: string; checked: number; items: readonly string[] };
}
export const STARTER_COLUMNS: readonly {
  name: string;
  cards: readonly StarterCard[];
}[] = [
  {
    name: 'Start Here',
    cards: [
      {
        title: 'Welcome to Kanvexa',
        labels: ['Getting Started'],
        assigned: true,
        startDay: 0,
        dueDay: 1,
        description:
          'Kanvexa brings your tasks, project notes, and deadlines together on a collaborative Kanban board. Columns organize the work, and each card holds the details you need to move it forward.\n\nThis is your editable sample board. Try the actions below, replace the examples with your own work, or remove the sample board from the Board actions menu when you are ready.',
        checklist: {
          title: 'Take your first steps',
          checked: 0,
          items: [
            'Open this card',
            'Edit its title to make it your own',
            'Explore labels, dates, and checklist details',
            'Move the card to another column',
          ],
        },
      },
      {
        title: 'Explore Your First Board',
        labels: ['Tutorial', 'Board'],
        description:
          'A board is a shared place for one project or area of work. Columns describe how you organize tasks; their names are yours to change. Drag a card between columns as work moves forward.\n\nThe Board, Calendar, and Table controls show the same cards from different perspectives. Switching views keeps the underlying work intact.',
        checklist: {
          title: 'Find your way around',
          checked: 0,
          items: [
            'Look through the four columns',
            'Move a card from To Do to In Progress',
            'Use the Board view switcher and return to Kanban',
          ],
        },
      },
      {
        title: 'Make This Workspace Yours',
        labels: ['Tips', 'Workspace'],
        description:
          'Your Personal Workspace groups your own boards in one place. Give each board a clear name and use its description to explain what belongs there.\n\nAs the board owner, you can change its background in Board settings. Organize the sample cards around your own project, and keep or remove the examples as you learn.',
        checklist: {
          title: 'Personalize your setup',
          checked: 0,
          items: [
            'Rename a board in Board settings',
            'Choose a background with comfortable contrast',
            'Arrange cards in the order you want to work on them',
          ],
        },
      },
    ],
  },
  {
    name: 'To Do',
    cards: [
      {
        title: 'Plan Your First Project',
        labels: ['Planning', 'High Priority'],
        assigned: true,
        startDay: 0,
        dueDay: 7,
        description:
          'Turn an idea into a small, achievable project. Start with the outcome, break it into tasks, and decide what matters this week. The High Priority badge is an ordinary label you can rename or remove.\n\nThis example starts on your registration day and is due a week later. One sample step is already checked to show how partial progress appears in every board view.',
        checklist: {
          title: 'Project planning',
          checked: 1,
          items: [
            'Write a one-sentence project goal',
            'List the first three deliverables',
            'Estimate the work and set realistic dates',
            'Choose the next task to start',
          ],
        },
      },
      {
        title: 'Organize Tasks with Labels',
        labels: ['Tutorial', 'Board', 'Planning'],
        description:
          'Labels help you scan a busy board without changing how cards move through columns. Use colors and clear names for topics, work types, or attention needed. A card can have several labels.\n\nOpen Labels in a card to create or assign a label, then use the board Filter control to find related work. Label colors and names also appear in Calendar and Table.',
        checklist: {
          title: 'Make labels useful',
          checked: 1,
          items: [
            'Compare the colored labels on this card',
            'Create or rename a label for your project',
            'Filter the board by a label and clear the filter',
          ],
        },
      },
      {
        title: 'Schedule Your Upcoming Work',
        labels: ['Planning', 'Tips'],
        assigned: true,
        startDay: 1,
        dueDay: 3,
        description:
          'Start dates describe when you intend to begin; due dates describe the deadline. Edit either in Card Detail and use the time zone configured in your account preferences.\n\nCalendar places each card on its due-date day. This example is due three days after signup. Cards without due dates remain on the board and in Table, with an unscheduled explanation in Calendar.',
        checklist: {
          title: 'Schedule a task',
          checked: 0,
          items: [
            'Open the date controls in this card',
            'Choose a start date before the due date',
            'Find the card on its due day in Calendar',
          ],
        },
      },
    ],
  },
  {
    name: 'In Progress',
    cards: [
      {
        title: 'Try a Checklist',
        labels: ['In Progress', 'Tutorial'],
        assigned: true,
        description:
          'Checklists turn a larger card into manageable next steps. Add, rename, reorder, and check items as the work progresses. Completion counts and progress bars update in Card Detail and in the other board views.\n\nTwo example items are checked here so you can compare partial progress with the completed examples in Done. Try unchecking one, or add a step that fits your own work.',
        checklist: {
          title: 'Practice checklist actions',
          checked: 2,
          items: [
            'Read the checklist introduction',
            'Compare completed and incomplete items',
            'Check an item and watch progress update',
            'Add a useful next step',
            'Reorder the remaining steps',
          ],
        },
      },
      {
        title: 'Explore Different Board Views',
        labels: ['Board', 'Tutorial'],
        startDay: 2,
        dueDay: 10,
        description:
          'Kanban is useful for moving work through columns. Calendar helps you see deadlines across a month, and its inspector previews the selected card. Table makes it easier to compare labels, assignees, dates, checklist progress, columns, and due-date status.\n\nAll three views use the same real cards. Open a card from any view to edit its details, and use filters to narrow down the work you see.',
        checklist: {
          title: 'Compare the views',
          checked: 1,
          items: [
            'Explore the Kanban columns',
            'Select this dated card in Calendar',
            'Find this card and its Column and Status in Table',
          ],
        },
      },
    ],
  },
  {
    name: 'Done',
    cards: [
      {
        title: 'Your Workspace Is Ready',
        labels: ['Completed'],
        assigned: true,
        description:
          'Your Personal Workspace and this private board are ready to use. This completed example shows how a finished checklist looks alongside work that has not started.\n\nDone is a column name, not a separate task-completion field. Move cards into the column that best describes your process, and keep dates and checklists accurate as your plans change.',
        checklist: {
          title: 'A ready-to-use example',
          checked: 3,
          items: [
            'Create a Personal Workspace',
            'Prepare a private board with organized columns',
            'Include examples of cards and metadata',
          ],
        },
      },
      {
        title: 'Discover Kanvexa Features',
        labels: ['Completed', 'Getting Started'],
        description:
          'Use descriptions, labels, assignees, dates, and checklists to keep context with each task. Search and filters help you find work; comments and activity support collaboration when you choose to share a board.\n\nKanvexa also provides multiple board views and keyboard shortcuts in account settings. These example checkmarks illustrate a completed list; no comments, attachments, activity, or assignment notifications were fabricated for this board.',
        checklist: {
          title: 'Features to explore',
          checked: 4,
          items: [
            'Keep task details together in Card Detail',
            'Organize work with labels and checklists',
            'Compare Kanban, Calendar, and Table',
            'Find keyboard shortcuts in account settings',
          ],
        },
      },
    ],
  },
];
