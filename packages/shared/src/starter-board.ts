/** Owner-only preview; version binds confirmation to the current persisted graph. */
export interface StarterBoardRemovalPreview {
  boardName: string;
  isCustomized: boolean;
  version: string;
  confirmation: 'REMOVE SAMPLE BOARD' | 'DELETE MY CUSTOMIZED BOARD';
}
export interface RemoveStarterBoardRequest {
  version: string;
  confirmation: string;
}
