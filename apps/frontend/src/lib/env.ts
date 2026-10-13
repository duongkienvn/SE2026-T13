const DEFAULT_API_BASE_URL = 'http://localhost:3000/api';

/** Public, client-safe configuration read from `VITE_*` variables. */
export const env = {
  apiBaseUrl: (
    import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL
  ).replace(/\/+$/, ''),
};
