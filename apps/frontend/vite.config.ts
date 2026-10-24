import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repositoryRoot, '');

  return {
    plugins: [react(), tailwindcss()],
    // Read VITE_* variables from the shared root .env file.
    envDir: repositoryRoot,
    server: {
      port: Number(env.WEB_PORT || 5173),
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
        'Referrer-Policy': 'no-referrer-when-downgrade',
      },
    },
    preview: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
        'Referrer-Policy': 'no-referrer-when-downgrade',
      },
    },
    test: { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'] },
  };
});
