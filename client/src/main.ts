import './assets/main.css'
import './lib/echarts'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { i18n } from './i18n'
import { useLocaleStore } from './stores/locale'
import { useAuth } from './features/auth/composables/useAuth'
import { useSetupStatus } from './features/auth/composables/useSetupStatus'

// Chrome 124+ blocks aria-hidden from being applied to an element that contains
// a focused descendant. Reka UI's dialog uses the aria-hidden package which sets
// aria-hidden="true" on background content when a modal opens. If the focused
// element is in the background (e.g. a book card dropdown trigger), Chrome blocks
// it and logs a warning, leaving the background incorrectly accessible to screen
// readers. This observer proactively blurs the focused descendant the moment
// aria-hidden="true" lands, allowing the aria-hidden to succeed.
const ariaHiddenObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type !== 'attributes' || mutation.attributeName !== 'aria-hidden') continue
    const target = mutation.target as HTMLElement
    if (target.getAttribute('aria-hidden') !== 'true') continue
    const focused = document.activeElement
    if (focused instanceof HTMLElement && target.contains(focused)) {
      focused.blur()
    }
  }
})
ariaHiddenObserver.observe(document.body, {
  subtree: true,
  attributes: true,
  attributeFilter: ['aria-hidden'],
})

const app = createApp(App)

app.use(createPinia())
app.use(i18n)

// Load and apply the initial locale (stored preference or browser language) before mount
// so the first paint is already localized. Server-synced locale is applied later during auth.
const localeStore = useLocaleStore()
await localeStore.setLocale(localeStore.locale)

// Resolve setup status/auth before installing router.
// app.use(router) triggers initial navigation and guard execution.
const { fetchSetupStatus, needsSetup } = useSetupStatus()
try {
  await fetchSetupStatus()
} catch {
  // If setup-status check fails, continue with normal auth bootstrap.
}

const { init } = useAuth()
if (needsSetup.value !== true) {
  await init()
}

app.use(router)
app.mount('#app')

function prefetchPdfReader() {
  void Promise.all([import('./features/reader/pdf-v4/PdfV4ReaderView.vue'), import('@embedpdf/pdfium/pdfium.wasm?url')]).then(([, wasm]) => {
    void fetch(wasm.default, { cache: 'force-cache' })
  })
}

const idleWindow = window as Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number }
if (idleWindow.requestIdleCallback) {
  idleWindow.requestIdleCallback(prefetchPdfReader, { timeout: 10_000 })
} else {
  window.setTimeout(prefetchPdfReader, 5_000)
}
