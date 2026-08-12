import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// GitHub Pages: https://<user>.github.io/FF14-Timeline-Voice-Coach/
// Override with BASE_PATH env var when deploying elsewhere.
const base = process.env.BASE_PATH ?? '/FF14-Timeline-Voice-Coach/';

export default defineConfig({
  base,
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
