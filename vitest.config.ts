import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/worker/dedicated.worker.ts', 'src/worker/shared.worker.ts'],
    },
  },
  resolve: {
    alias: {
      'inferis': '/Users/p.fits/WebstormProjects/inferis/src/index.ts',
    },
  },
});
