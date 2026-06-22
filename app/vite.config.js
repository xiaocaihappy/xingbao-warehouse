import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    target: 'chrome134',
    cssMinify: 'lightningcss',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'react-vendor';
          if (id.includes('node_modules/@supabase')) return 'supabase-vendor';
          if (id.includes('node_modules/xlsx')) return 'xlsx-vendor';
          if (id.includes('node_modules/jszip')) return 'jszip-vendor';
        },
      },
    },
    reportCompressedSize: false,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});