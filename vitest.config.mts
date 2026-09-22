import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: ['src/**/*.golden.test.ts'],
        },
      },
      {
        // PDF golden-file suite. Runs in node, not jsdom: it writes and parses
        // real PDF bytes and must not be touched by a DOM shim. See
        // IMPLEMENTATION_PLAN.md P8.*.
        extends: true,
        test: {
          name: 'golden',
          environment: 'node',
          include: ['src/**/*.golden.test.ts'],
        },
      },
    ],
  },
});
