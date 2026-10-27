export const avatarKeys = {
  all: ['avatar'] as const,
  image: (generation: number, path: string) =>
    [...avatarKeys.all, generation, path] as const,
};
