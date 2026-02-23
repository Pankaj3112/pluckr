import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    exclude: ['packages/**', '**/node_modules/**', 'examples/**'],
  },
})
