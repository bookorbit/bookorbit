import { fileURLToPath, URL } from 'node:url'
import { Agent } from 'node:http'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const apiAgent = new Agent({ keepAlive: true })
/** Lets a second dev client point at a throwaway API instance, so restart testing leaves the main stack alone. */
const apiTarget = process.env.BOOKORBIT_API_TARGET ?? 'http://localhost:6262'

// https://vite.dev/config/
export default defineConfig({
  define: {
    __INTLIFY_PROD_DEVTOOLS__: false,
    __VUE_I18N_FULL_INSTALL__: true,
    __VUE_I18N_LEGACY_API__: false,
  },
  plugins: [
    vue(),
    vueDevTools(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: [
        'favicon.ico',
        'pwa-icon-source.svg',
        'apple-touch-icon-180x180.png',
        'pwa-64x64.png',
        'pwa-192x192.png',
        'pwa-512x512.png',
        'maskable-icon-512x512.png',
      ],
      manifest: {
        name: 'BookOrbit',
        short_name: 'BookOrbit',
        description: 'Your personal book library and reading space',
        theme_color: '#1e1e18',
        background_color: '#fafaf8',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'pwa-64x64.png',
            sizes: '64x64',
            type: 'image/png',
          },
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        shortcuts: [
          {
            name: 'Dashboard',
            short_name: 'Dashboard',
            url: '/dashboard',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }],
          },
          {
            name: 'Libraries',
            short_name: 'Libraries',
            url: '/libraries',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }],
          },
          {
            name: 'Settings',
            short_name: 'Settings',
            url: '/settings',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }],
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        globIgnores: ['**/assets/foliate/**'],
        // vite-plugin-pwa defaults this to 'index.html' when omitted, which registers a cache-only
        // NavigationRoute ahead of the network-first route below and shadows it.
        navigateFallback: null,
        runtimeCaching: [
          {
            // Page loads must hit the network first: an edge auth proxy (e.g. Cloudflare Access) needs to
            // see every navigation to redirect an expired session to its login page. Serving the precached
            // shell unconditionally (the old `navigateFallback` behavior) hid the request from the proxy
            // entirely and left the app stuck logged out with no way back in short of clearing site data.
            urlPattern: ({ request, url }) => request.mode === 'navigate' && !url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'app-shell',
              networkTimeoutSeconds: 10,
              precacheFallback: {
                fallbackURL: 'index.html',
              },
              // Status 0 here would include an auth proxy's opaqueredirect and cache it as the page.
              cacheableResponse: {
                statuses: [200],
              },
            },
          },
          {
            urlPattern: /^.*\/api\/v1\/books\/\d+\/cover\?(?:[^#]*&)?t=[^#]*$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'book-covers',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^.*\/api\/v1\/books\/\d+\/thumbnail\?(?:[^#]*&)?t=[^#]*$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'book-thumbnails',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^.*\/api\/v1\/books\/\d+\/cover(\?.*)?$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'book-covers',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^.*\/api\/v1\/books\/\d+\/thumbnail(\?.*)?$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'book-thumbnails',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
        type: 'module',
      },
    }),
  ],
  resolve: {
    dedupe: ['vue'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@bookorbit/types': fileURLToPath(new URL('../packages/types/src/index.ts', import.meta.url)),
    },
  },
  optimizeDeps: {
    include: ['@tanstack/vue-virtual'],
    exclude: ['@embedpdf/core', '@embedpdf/core/vue'],
  },
  server: {
    port: 6263,
    strictPort: true,
    host: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: apiTarget,
        agent: apiAgent,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            if (req.headers.host) proxyReq.setHeader('x-forwarded-host', req.headers.host)
            const localPort = (req.socket as { localPort?: number })?.localPort
            if (localPort) proxyReq.setHeader('x-forwarded-port', String(localPort))
            proxyReq.setHeader('x-forwarded-proto', 'http')
          })
        },
      },
      '/socket.io': {
        target: apiTarget,
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
