import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { useAuth } from './features/auth/composables/useAuth'
import { useSetupStatus } from './features/auth/composables/useSetupStatus'

const app = createApp(App)

app.use(createPinia())

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
