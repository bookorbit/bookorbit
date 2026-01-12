import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { useAuth } from './features/auth/composables/useAuth'

const app = createApp(App)

app.use(createPinia())

// Init auth before installing router — app.use(router) triggers the initial
// navigation which runs the beforeEach guard. If auth isn't resolved yet,
// user.value is null and the guard redirects every reload to /login.
const { init } = useAuth()
await init()

app.use(router)
app.mount('#app')
