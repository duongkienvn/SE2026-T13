import type {
  CardChecklists,
  Checklist,
  Item,
} from '../../src/features/cards/checklists/api.ts';

const part = (value: number) => value.toString(16).padStart(12, '0');
export const checklistId = (value: number) =>
  `00000000-0000-4000-9000-${part(value)}`;
const date = '2026-11-15T12:00:00.000Z';
const row = (id: string, position: string) => ({
  id,
  position,
  createdAt: date,
  updatedAt: date,
});

function counts(checkedItems: number, totalItems: number) {
  return {
    checkedItems,
    totalItems,
    completionPercentage: totalItems
      ? Math.round((10000 * checkedItems) / totalItems) / 100
      : 0,
  };
}

export function checklist(
  cardId: string,
  number: number,
  checks: boolean[] = [],
  title = `List ${number}`,
): Checklist {
  const id = checklistId(number);
  const items = checks.map((isChecked, i) => ({
    ...row(checklistId(1000 * number + i), `${(i + 1) * 100}.0000000000`),
    checklistId: id,
    text: `Item ${number}.${i + 1}`,
    isChecked,
  }));
  return {
    ...row(id, `${100 * number}.0000000000`),
    title,
    cardId,
    ...itemCounts(items),
    items,
  };
}

export function itemCounts(items: readonly Item[]) {
  return counts(
    items.filter(({ isChecked }) => isChecked).length,
    items.length,
  );
}

export function checklists(
  cardId: string,
  rows: Checklist[] = [],
): CardChecklists {
  return {
    cardId,
    checklists: rows,
    ...counts(
      rows.reduce((sum, list) => sum + list.checkedItems, 0),
      rows.reduce((sum, list) => sum + list.totalItems, 0),
    ),
  };
}
