import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The poker engine is pure server-side TypeScript — no DOM needed.
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
  },
});
