import { isBuiltin } from 'node:module'
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'lib/types/index.js' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: {
    neverBundle: specifier => isBuiltin(specifier) || specifier.startsWith('@deepseek-ai/'),
  },
})
