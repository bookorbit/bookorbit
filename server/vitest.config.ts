import path from 'path';
import { defineConfig } from 'vitest/config';

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
