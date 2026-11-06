import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/labventure',
  plugins: [react()],
  server: {
    // server/shared holds rules used by both sides (dailyReportRules.mjs)
    fs: { allow: ['..'] },
    proxy: {
      '/api': {
        target: process.env.API_TARGET || 'http://localhost:8889',
        changeOrigin: true,
        credentials: true,
        // allow SSE / streaming responses to pass through without buffering
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes, req) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              proxyRes.headers['x-accel-buffering'] = 'no';
            }
          });
        },
      },
    },
  },
});
