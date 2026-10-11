<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import PublicLegalNotices from '@/components/legal/PublicLegalNotices.vue'
import AuthAppearanceToolbar from './components/AuthAppearanceToolbar.vue'
import { useAuth } from './composables/useAuth'

const { t } = useI18n()
const { setup } = useAuth()

const username = ref('')
const name = ref('')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const setupToken = ref('')

const loading = ref(false)
const error = ref<string | null>(null)

async function handleSubmit() {
  error.value = null

  if (password.value !== confirmPassword.value) {
    error.value = t('auth.errors.passwordsDoNotMatch')
    return
  }

  loading.value = true
  try {
    await setup({
      username: username.value,
      name: name.value,
      email: email.value,
      password: password.value,
      setupToken: setupToken.value || undefined,
    })
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('auth.setup.errors.failed')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-bg min-h-screen flex flex-col items-center justify-center gap-3 px-4 overflow-hidden">
    <AuthAppearanceToolbar placement="bottom" />

    <div class="login-card relative z-10 w-full max-w-md rounded-2xl p-8">
      <div class="mb-6">
        <h1 class="text-xl font-semibold text-foreground">{{ t('auth.setup.title') }}</h1>
        <p class="text-sm text-muted-foreground mt-1">{{ t('auth.setup.subtitle') }}</p>
      </div>

      <form class="space-y-4" @submit.prevent="handleSubmit">
        <div class="space-y-1.5">
          <label for="setup-username" class="text-sm font-medium text-foreground">{{ t('auth.fields.username') }}</label>
          <input
            id="setup-username"
            v-model="username"
            type="text"
            autocomplete="username"
            required
            class="w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 backdrop-blur-sm"
          />
        </div>

        <div class="space-y-1.5">
          <label for="setup-name" class="text-sm font-medium text-foreground">{{ t('auth.fields.fullName') }}</label>
          <input
            id="setup-name"
            v-model="name"
            type="text"
            autocomplete="name"
            required
            class="w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 backdrop-blur-sm"
          />
        </div>

        <div class="space-y-1.5">
          <label for="setup-email" class="text-sm font-medium text-foreground">{{ t('auth.fields.email') }}</label>
          <input
            id="setup-email"
            v-model="email"
            type="email"
            autocomplete="email"
            required
            class="w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 backdrop-blur-sm"
          />
        </div>

        <div class="space-y-1.5">
          <label for="setup-password" class="text-sm font-medium text-foreground">{{ t('auth.fields.password') }}</label>
          <input
            id="setup-password"
            v-model="password"
            type="password"
            autocomplete="new-password"
            required
            class="w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 backdrop-blur-sm"
          />
          <p class="text-xs text-muted-foreground">{{ t('auth.fields.passwordHint') }}</p>
        </div>

        <div class="space-y-1.5">
          <label for="setup-confirm-password" class="text-sm font-medium text-foreground">{{ t('auth.fields.confirmPassword') }}</label>
          <input
            id="setup-confirm-password"
            v-model="confirmPassword"
            type="password"
            autocomplete="new-password"
            required
            class="w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 backdrop-blur-sm"
          />
        </div>

        <div class="space-y-1.5">
          <label for="setup-token" class="text-sm font-medium text-foreground">
            {{ t('auth.setup.setupToken') }}
            <span class="text-muted-foreground">{{ t('auth.setup.setupTokenHint') }}</span>
          </label>
          <input
            id="setup-token"
            v-model="setupToken"
            type="text"
            autocomplete="off"
            class="w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 backdrop-blur-sm"
          />
        </div>

        <div v-if="error" class="text-sm text-destructive">{{ error }}</div>

        <button
          type="submit"
          :disabled="loading"
          class="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {{ loading ? t('auth.setup.creatingAccount') : t('auth.setup.createAccount') }}
        </button>
      </form>
    </div>
    <PublicLegalNotices />
  </div>
</template>

<style scoped>
.login-bg {
  position: relative;
}

.login-card {
  background: color-mix(in oklch, var(--card) 72%, transparent);
  border: 1px solid color-mix(in oklch, var(--border) 55%, transparent);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  box-shadow: var(--elevation-xl);
}
</style>
