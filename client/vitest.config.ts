import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
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
