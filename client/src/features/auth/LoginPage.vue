<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { OidcPublicConfig } from '@projectx/types'
import { Moon, Sun } from 'lucide-vue-next'
import { ACCENT_VIVID, ACCENT_PASTEL, ACCENT_OPTIONS, useThemeStore } from '@/stores/theme'
import { useAuth } from './composables/useAuth'
import { useOidc } from './composables/useOidc'

const themeStore = useThemeStore()
const accentOpen = ref(false)
const currentAccent = computed(() => ACCENT_OPTIONS.find((o) => o.id === themeStore.accent))

const { login } = useAuth()
const { getPublicConfig, initiateLogin } = useOidc()

const username = ref('')
const password = ref('')
const error = ref<string | null>(null)
const loading = ref(false)
const oidcConfig = ref<OidcPublicConfig | null>(null)
const oidcLoading = ref(false)

onMounted(async () => {
  oidcConfig.value = await getPublicConfig()
})

async function handleSubmit() {
  error.value = null
  loading.value = true
  try {
    await login(username.value, password.value)
  } catch {
    error.value = 'Invalid username or password'
  } finally {
    loading.value = false
  }
}

async function handleOidcLogin() {
  error.value = null
  oidcLoading.value = true
  try {
    await initiateLogin()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'OIDC login failed'
    oidcLoading.value = false
  }
}
</script>

<template>
  <div class="login-bg min-h-screen flex items-center justify-center px-4 overflow-hidden">
    <div class="blob blob-1" />
    <div class="blob blob-2" />
    <div class="blob blob-3" />

    <!-- Compact theme picker -->
    <div class="fixed bottom-5 right-5 z-20 flex items-center gap-1.5">
      <!-- Dark / light toggle -->
      <button class="theme-btn" :title="themeStore.theme === 'dark' ? 'Switch to light' : 'Switch to dark'" @click="themeStore.toggleTheme()">
        <Sun v-if="themeStore.theme === 'dark'" :size="14" />
        <Moon v-else :size="14" />
      </button>

      <!-- Accent picker -->
      <div class="relative">
        <!-- Colour popover -->
        <Transition name="popover">
          <div v-if="accentOpen" class="accent-popover absolute bottom-full right-0 mb-2 p-3 rounded-xl space-y-2">
            <div class="flex items-center gap-1.5">
              <button
                v-for="opt in ACCENT_VIVID"
                :key="opt.id"
                :title="opt.label"
                class="w-4 h-4 rounded-full transition-all hover:scale-125 focus:outline-none shrink-0"
                :style="{
                  backgroundColor: opt.color,
                  outline: themeStore.accent === opt.id ? `2px solid ${opt.color}` : 'none',
                  outlineOffset: '2px',
                  transform: themeStore.accent === opt.id ? 'scale(1.2)' : '',
                }"
                @click="themeStore.setAccent(opt.id)"
              />
            </div>
            <div class="flex items-center gap-1.5">
              <button
                v-for="opt in ACCENT_PASTEL"
                :key="opt.id"
                :title="opt.label"
                class="w-4 h-4 rounded-full transition-all hover:scale-125 focus:outline-none shrink-0"
                :style="{
                  backgroundColor: opt.color,
                  outline: themeStore.accent === opt.id ? `2px solid ${opt.color}` : 'none',
                  outlineOffset: '2px',
                  transform: themeStore.accent === opt.id ? 'scale(1.2)' : '',
                }"
                @click="themeStore.setAccent(opt.id)"
              />
            </div>
          </div>
        </Transition>

        <!-- Swatch button showing current accent -->
        <button class="theme-btn" title="Change accent color" @click="accentOpen = !accentOpen">
          <span class="w-3.5 h-3.5 rounded-full block" :style="{ backgroundColor: currentAccent?.color }" />
        </button>
      </div>
    </div>

    <!-- Click-outside backdrop -->
    <div v-if="accentOpen" class="fixed inset-0 z-10" @click="accentOpen = false" />

    <div class="login-card relative z-10 w-full max-w-sm rounded-2xl p-8">
      <div class="text-center mb-8">
        <h1 class="text-2xl font-serif font-semibold text-foreground">project<span class="text-primary">x</span></h1>
        <p class="text-sm text-muted-foreground mt-1">Sign in to your account</p>
      </div>

      <form @submit.prevent="handleSubmit" class="space-y-4">
        <div class="space-y-1.5">
          <label for="username" class="text-sm font-medium text-foreground">Username</label>
          <input
            id="username"
            v-model="username"
            type="text"
            autocomplete="username"
            required
            class="w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 backdrop-blur-sm"
          />
        </div>

        <div class="space-y-1.5">
          <label for="password" class="text-sm font-medium text-foreground">Password</label>
          <input
            id="password"
            v-model="password"
            type="password"
            autocomplete="current-password"
            required
            class="w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 backdrop-blur-sm"
          />
        </div>

        <div v-if="error" class="text-sm text-destructive">{{ error }}</div>

        <button
          type="submit"
          :disabled="loading"
          class="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {{ loading ? 'Signing in...' : 'Sign in' }}
        </button>
      </form>

      <template v-if="oidcConfig?.enabled">
        <div class="flex items-center gap-3 my-6">
          <div class="flex-1 h-px bg-border" />
          <span class="text-xs text-muted-foreground">or</span>
          <div class="flex-1 h-px bg-border" />
        </div>

        <button
          type="button"
          :disabled="oidcLoading"
          class="w-full rounded-md border border-input bg-background/60 px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/60 disabled:opacity-50 transition-colors backdrop-blur-sm"
          @click="handleOidcLogin"
        >
          {{ oidcLoading ? 'Redirecting...' : `Sign in with ${oidcConfig.providerName || 'SSO'}` }}
        </button>
      </template>

      <p class="mt-4 text-center text-sm text-muted-foreground">
        <RouterLink to="/forgot-password" class="text-primary hover:underline">Forgot password?</RouterLink>
      </p>
    </div>
  </div>
</template>

<style scoped>
.login-bg {
  background: var(--background);
  position: relative;
}

.blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(90px);
  pointer-events: none;
}

.blob-1 {
  width: 640px;
  height: 520px;
  background: color-mix(in oklch, var(--primary) 28%, transparent);
  top: -12%;
  left: -18%;
  animation: drift-1 20s ease-in-out infinite alternate;
}

.blob-2 {
  width: 520px;
  height: 560px;
  background: color-mix(in oklch, var(--primary) 18%, transparent);
  bottom: -18%;
  right: -12%;
  animation: drift-2 26s ease-in-out infinite alternate;
}

.blob-3 {
  width: 420px;
  height: 420px;
  background: color-mix(in oklch, var(--primary) 14%, transparent);
  top: 35%;
  left: 38%;
  animation: drift-3 18s ease-in-out infinite alternate;
}

@keyframes drift-1 {
  from {
    transform: translate(0, 0) scale(1);
  }
  to {
    transform: translate(70px, 55px) scale(1.12);
  }
}

@keyframes drift-2 {
  from {
    transform: translate(0, 0) scale(1);
  }
  to {
    transform: translate(-55px, -70px) scale(1.08);
  }
}

@keyframes drift-3 {
  0% {
    transform: translate(0, 0) scale(1);
  }
  50% {
    transform: translate(-35px, 28px) scale(0.92);
  }
  100% {
    transform: translate(35px, -28px) scale(1.1);
  }
}

.theme-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 9999px;
  background: color-mix(in oklch, var(--card) 72%, transparent);
  border: 1px solid color-mix(in oklch, var(--border) 55%, transparent);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow: var(--elevation-md);
  color: var(--muted-foreground);
  transition: color 0.15s ease;
}

.theme-btn:hover {
  color: var(--foreground);
}

.accent-popover {
  background: color-mix(in oklch, var(--card) 80%, transparent);
  border: 1px solid color-mix(in oklch, var(--border) 55%, transparent);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  box-shadow: var(--elevation-lg);
}

.popover-enter-active,
.popover-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.popover-enter-from,
.popover-leave-to {
  opacity: 0;
  transform: translateY(4px) scale(0.97);
}

.login-card {
  background: color-mix(in oklch, var(--card) 72%, transparent);
  border: 1px solid color-mix(in oklch, var(--border) 55%, transparent);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  box-shadow: var(--elevation-xl);
}
</style>
