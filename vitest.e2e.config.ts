import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin } from '../deepseek-harness-pactflow-p0/vitest.shared.ts'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [standardDecoratorPlugin()],
  test: {
    include: ['packages/dsh-pactflow/e2e/**/*.spec.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    maxWorkers: 1,
  },
})
