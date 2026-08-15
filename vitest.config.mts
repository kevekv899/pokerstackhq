import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Mirrors the `@/*` path alias in tsconfig.json. Type-only imports are erased
  // and never needed this, but a test that imports a route handler pulls its
  // real `@/lib/...` dependencies in at runtime.
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // The poker engine is pure server-side TypeScript — no DOM needed.
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
  },
});
