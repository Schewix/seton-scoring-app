import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { ROUTE_PREFIX, STATION_ROUTE_PREFIX } from './src/routing';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Zelená liga - Stanoviště',
        short_name: 'Zelená liga',
        description: 'Offline scoring aplikace pro rozhodčí Zelené ligy.',
        theme_color: '#0b5d44',
        background_color: '#0b5d44',
        display: 'standalone',
        scope: `${ROUTE_PREFIX}/`,
        start_url: STATION_ROUTE_PREFIX,
        lang: 'cs',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,json}'],
      },
    }),
  ],
  build: {
    target: 'es2022',
  },
  esbuild: {
    target: 'es2022',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
});
