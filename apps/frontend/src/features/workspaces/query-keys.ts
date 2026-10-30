export const workspaceKeys = {
  all: ['workspaces'] as const,
  session: (userId: string, generation: number) =>
    [...workspaceKeys.all, userId, generation] as const,
  list: (userId: string, generation: number) =>
    [...workspaceKeys.session(userId, generation), 'list'] as const,
  resource: (userId: string, generation: number, workspaceId: string) =>
    [
      ...workspaceKeys.session(userId, generation),
      'workspace',
      workspaceId,
    ] as const,
  overview: (userId: string, generation: number, workspaceId: string) =>
    [
      ...workspaceKeys.resource(userId, generation, workspaceId),
      'overview',
    ] as const,
  boards: (userId: string, generation: number, workspaceId: string) =>
    [
      ...workspaceKeys.resource(userId, generation, workspaceId),
      'boards',
    ] as const,
  members: (userId: string, generation: number, workspaceId: string) =>
    [
      ...workspaceKeys.resource(userId, generation, workspaceId),
      'members',
    ] as const,
  detail: (userId: string, generation: number, workspaceId: string) =>
    [
      ...workspaceKeys.resource(userId, generation, workspaceId),
      'detail',
    ] as const,
  policies: (userId: string, generation: number, workspaceId: string) =>
    [
      ...workspaceKeys.resource(userId, generation, workspaceId),
      'policies',
    ] as const,
  invitations: (userId: string, generation: number, workspaceId: string) =>
    [
      ...workspaceKeys.resource(userId, generation, workspaceId),
      'invitations',
    ] as const,
};
