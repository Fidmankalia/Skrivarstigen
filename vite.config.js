import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // vi registrerar själva i main.jsx (med tvingad uppdatering)
      includeAssets: ['favicon.svg', 'icons.svg'],
      manifest: {
        name: 'Skrivstigen',
        short_name: 'Skrivstigen',
        description: 'Skriv och upplev interaktiva berättelser med AI.',
        lang: 'sv',
        theme_color: '#16241d',
        background_color: '#12202a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
