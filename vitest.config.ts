import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      include: ['apps/api/src/**/*.ts'],
      exclude: ['apps/api/src/index.ts', 'apps/api/src/db/seed.ts'],
      reporter: ['text-summary', 'html'],
    },
  },
});
