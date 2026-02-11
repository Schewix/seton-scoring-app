import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/test/integration/**/*.test.ts'],
    setupFiles: ['src/test/integration/setup.ts'],
    testTimeout: 30_000,
  },
});
