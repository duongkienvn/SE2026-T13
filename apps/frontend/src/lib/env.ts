const DEFAULT_API_BASE_URL = 'http://localhost:3000/api';

/** Public, client-safe configuration read from `VITE_*` variables. */
export const env = {
  apiBaseUrl: (
    import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL
  ).replace(/\/+$/, ''),
  /**
   * Optional task email (P4-05) is off unless the deployment says its sender
   * is turned on (`TASK_NOTIFICATION_EMAIL_ENABLED`). The UI never infers it.
   */
  taskEmailEnabled: import.meta.env.VITE_TASK_EMAIL_ENABLED === 'true',
};
