import path from 'path';
import { defineConfig } from 'vitest/config';

const e2eDatabaseUrl = process.env.E2E_DATABASE_URL ?? 'postgres://projectx:projectx@localhost:5432/projectx_e2e';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      '@projectx/types': path.resolve(__dirname, '../packages/types/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    fileParallelism: false,
    setupFiles: ['test/e2e.setup.ts'],
    include: ['test/**/*.e2e-spec.ts'],
    passWithNoTests: true,
    reporters: process.env.CI ? ['default', 'github-actions'] : ['default'],
    env: {
      DATABASE_URL: e2eDatabaseUrl,
    },
  },
});
