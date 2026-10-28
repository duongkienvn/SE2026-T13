export const workspaceKeys = {
  all: ['workspaces'] as const,
  session: (userId: string, generation: number) =>
    [...workspaceKeys.all, userId, generation] as const,
  list: (userId: string, generation: number) =>
    [...workspaceKeys.session(userId, generation), 'list'] as const,
  overview: (userId: string, generation: number, workspaceId: string) =>
    [
      ...workspaceKeys.session(userId, generation),
      'overview',
      workspaceId,
    ] as const,
};
