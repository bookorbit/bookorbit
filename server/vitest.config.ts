import path from 'path';
import { availableParallelism } from 'os';
import { defineConfig } from 'vitest/config';

// Concurrent agents sharing this worktree each start their own runner, and an uncapped pool
// sizes itself to the whole machine. The lock wrapper raises this for the run that holds the
// lock; anything bypassing the wrapper stays on the conservative floor.
const localMaxWorkers = Number(process.env.BO_TEST_MAX_WORKERS) || Math.max(2, Math.floor(availableParallelism() / 3));

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      '@bookorbit/types': path.resolve(__dirname, '../packages/types/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    pool: 'threads',
    maxWorkers: process.env.CI ? undefined : localMaxWorkers,
    testTimeout: 15_000,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    passWithNoTests: true,
    reporters: process.env.CI ? ['default', 'github-actions'] : ['default'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/scripts/**',
        'src/**/*.module.ts',
        'src/main.ts',
        'src/db/schema/**',
        'src/**/*.types.ts',
        'src/**/*.interface.ts',
        'src/**/*.constants.ts',
        'src/**/*.enum.ts',
        'src/config/**',
        'src/common/types/**',
      ],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
      },
    },
  },
});
