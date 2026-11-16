/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // относительные пути: сборка работает и на GitHub Pages (подпапка /<repo>/), и локально
  base: './',
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
})
