import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5710,
    strictPort: true,
    proxy: { '/api': { target: process.env.BIOCANARY_API ?? 'http://127.0.0.1:8710', changeOrigin: false } },
  },
})
