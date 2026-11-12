import {
  destinationPath,
  parseResourceId,
  type Destination,
  type DestinationPath,
} from '../../src/navigation/routes';

const boardId = parseResourceId('01234567-89ab-cdef-0123-456789abcdef');
const cardId = parseResourceId('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
if (boardId && cardId) {
  const card: Destination = { kind: 'card', boardId, cardId };
  const path: DestinationPath = destinationPath(card);
  void path;
}

const invalidBoard: Destination = {
  kind: 'card',
  // @ts-expect-error Card destinations require a validated Board ID.
  boardId: 'unvalidated',
  cardId: cardId!,
};
// @ts-expect-error Search is a full-screen destination, not a bottom tab.
const invalidTab: Destination = { kind: 'tab', tab: 'search' };
void invalidBoard;
void invalidTab;
