import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ha-api': {
        // CHANGE THIS to your Home Assistant IP/hostname
        target: 'http://192.168.1.3:8123',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ha-api/, '/api'),
      },
    },
  },
})
