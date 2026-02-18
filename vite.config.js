import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  logLevel: 'error',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // Optional Vite dev support while `vercel dev` on :3000 remains the primary flow.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
