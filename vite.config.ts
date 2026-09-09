import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// GitHub Pages: https://<user>.github.io/FF14-Timeline-Voice-Coach/
// Override with BASE_PATH env var when deploying elsewhere.
const base = process.env.BASE_PATH ?? '/FF14-Timeline-Voice-Coach/';

// Single source of truth for the version shown in the UI. Hardcoding it in a
// component let the badge drift from package.json (it still said V0.1 at 0.2.0).
const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

export default defineConfig({
  base,
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
