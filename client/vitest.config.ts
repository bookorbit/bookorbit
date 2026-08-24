import { fileURLToPath } from 'node:url'
import { availableParallelism } from 'node:os'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config'

// Concurrent agents sharing this worktree each start their own runner, and an uncapped pool
// sizes itself to the whole machine. The lock wrapper raises this for the run that holds the
// lock; anything bypassing the wrapper stays on the conservative floor.
const localMaxWorkers = Number(process.env.BO_TEST_MAX_WORKERS) || Math.max(2, Math.floor(availableParallelism() / 3))

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      maxWorkers: process.env.CI ? undefined : localMaxWorkers,
      testTimeout: 15_000,
      setupFiles: ['./src/test-setup.ts'],
      // Node 26 defines `localStorage` and `sessionStorage` on globalThis, and jsdom shares that
      // object, so its own storage never gets installed. Node's `localStorage` then reads as
      // undefined unless the process was started with `--localstorage-file`, and its
      // `sessionStorage` is a process-wide store no test file can reset. Standing Node's
      // implementation down leaves jsdom's in place, isolated per test file.
      execArgv: ['--no-experimental-webstorage'],
      exclude: [...configDefaults.exclude, 'e2e/**'],
      root: fileURLToPath(new URL('./', import.meta.url)),
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html', 'lcov'],
        reportsDirectory: './coverage',
        include: ['src/**/*.{ts,vue}'],
        exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'src/**/__tests__/**', 'src/main.ts', 'src/**/*.d.ts', 'src/**/*.types.ts'],
        thresholds: {
          lines: 1,
          statements: 1,
          functions: 1,
          branches: 1,
        },
      },
    },
  }),
)
