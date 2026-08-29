import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { standardDecoratorPlugin } from '../deepseek-harness-pactflow-p0/vitest.shared.ts'

export default defineConfig({
  plugins: [
    tsconfigPaths({ projects: ['../deepseek-harness-pactflow-p0/tsconfig.host.json'] }),
    standardDecoratorPlugin(),
  ],
  test: {
    include: ['packages/dsh-pactflow/e2e/**/*.spec.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    maxWorkers: 1,
  },
})
