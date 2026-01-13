<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { OidcPublicConfig } from '@projectx/types'
import { useAuth } from './composables/useAuth'
import { useOidc } from './composables/useOidc'

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
  <div class="min-h-screen flex items-center justify-center bg-background px-4">
    <div class="w-full max-w-sm">
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
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
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
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
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
        <div class="relative my-6">
          <div class="absolute inset-0 flex items-center">
            <div class="w-full border-t border-border" />
          </div>
          <div class="relative flex justify-center text-xs">
            <span class="bg-background px-2 text-muted-foreground">or</span>
          </div>
        </div>

        <button
          type="button"
          :disabled="oidcLoading"
          class="w-full rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
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
