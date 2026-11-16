import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Сборка в один чанк для вшивания в единый html (scripts/singlefile.mjs).
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist-single',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 5000,
    rolldownOptions: { output: { codeSplitting: false } },
  },
})
