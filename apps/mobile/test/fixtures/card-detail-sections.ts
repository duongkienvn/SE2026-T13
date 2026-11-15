import { createElement } from 'react';
import { Text } from 'react-native';
import type {
  CardDetailSectionProps,
  CardDetailSections,
} from '../../src/features/cards/detail/sections';

/** Compile-checked downstream mount example; never imported by the app. */
export function CardSectionFixture({ context }: CardDetailSectionProps) {
  return createElement(
    Text,
    {
      accessibilityLabel: `${context.card.title}, ${context.readOnly ? 'read-only' : 'editable'}`,
    },
    'Independent section fixture',
  );
}

export const cardSectionsFixture = {
  Checklists: CardSectionFixture,
  Comments: CardSectionFixture,
} satisfies CardDetailSections;
