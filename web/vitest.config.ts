import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/__tests__/**/*.test.{ts,tsx}', 'src/__tests__/**/*.spec.{ts,tsx}'],
    exclude: ['src/test/integration/**', 'e2e/**'],
    setupFiles: ['src/test/setup.ts'],
  },
});
