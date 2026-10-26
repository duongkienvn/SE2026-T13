import { useRef } from 'react';
import { useLocation, useMatch, useNavigate } from 'react-router';

/** Only a card pushed by this mounted board may close with history Back. */
export function useCardRoute(boardId: string) {
  const location = useLocation();
  const navigate = useNavigate();
  const match = useMatch('/boards/:boardId/cards/:cardId');
  const source = useRef<{ key: string; cardId: string } | undefined>(undefined);
  const boardPath = `/boards/${boardId}`;
  const cardId = match?.params.cardId;

  return {
    cardId,
    openCard: (id: string) => {
      source.current = { key: location.key, cardId: id };
      void navigate(`${boardPath}/cards/${id}`, {
        state: {
          cardSourceKey: location.key,
          cardReturnTo: `${location.pathname}${location.search}${location.hash}`,
        },
      });
    },
    closeCard: () => {
      const state: unknown = location.state;
      const returnTo =
        state &&
        typeof state === 'object' &&
        'cardReturnTo' in state &&
        typeof state.cardReturnTo === 'string'
          ? state.cardReturnTo
          : boardPath;
      if (
        state &&
        typeof state === 'object' &&
        'cardSourceKey' in state &&
        state.cardSourceKey === source.current?.key &&
        cardId === source.current?.cardId
      ) {
        void navigate(-1);
      } else {
        // A reload/new tab has no known in-app history entry to go back to.
        const safeReturn =
          returnTo === boardPath ||
          returnTo.startsWith(`${boardPath}?`) ||
          returnTo.startsWith(`${boardPath}#`);
        void navigate(safeReturn ? returnTo : boardPath, { replace: true });
      }
    },
  };
}
