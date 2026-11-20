export const taskEmailEnabled = (flag: string | undefined) => flag === 'true';
// Expo statically replaces this exact public environment reference at build time.
export const emailEnabled = taskEmailEnabled(
  process.env.EXPO_PUBLIC_TASK_EMAIL_ENABLED,
);
