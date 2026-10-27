/** Session-private; `queryClient.clear()` at every session boundary drops them. */
export const preferencesKeys = {
  current: ['account', 'preferences'] as const,
};

export const preferencesMutationKey = ['account', 'preferences', 'update'];
