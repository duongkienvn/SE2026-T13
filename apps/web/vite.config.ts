import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  const env = loadEnv(
    mode,
    fileURLToPath(new URL('../..', import.meta.url)),
    '',
  );

  return {
    plugins: [react(), tailwindcss()],
    server: { port: Number(env.WEB_PORT || 5173) },
    test: { environment: 'jsdom' },
  };
});
