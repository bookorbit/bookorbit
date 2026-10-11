<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import PublicLegalNotices from '@/components/legal/PublicLegalNotices.vue'
import AuthAppearanceToolbar from './components/AuthAppearanceToolbar.vue'
import { RegisterError, useAuth } from './composables/useAuth'
import { checkIdentityText } from './lib/identity-text'

const { t } = useI18n()
const { register } = useAuth()

const username = ref('')
const name = ref('')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')

const loading = ref(false)
const error = ref<string | null>(null)

function resolveRegisterError(err: unknown): string {
  if (err instanceof RegisterError) {
    if (err.status === 403) return t('auth.register.errors.closed')
    if (err.status === 409) return t('auth.register.errors.taken')
    if (err.status === 429) return t('auth.register.errors.tooManyAttempts')
    if (err.status === 400) return t('auth.register.errors.invalid')
  }
  return t('auth.register.errors.failed')
}

async function handleSubmit() {
  error.value = null

  const usernameProblem = checkIdentityText(username.value)
  if (usernameProblem) {
    error.value = t(`auth.register.errors.username.${usernameProblem}`)
    return
  }

  const nameProblem = checkIdentityText(name.value)
  if (nameProblem) {
    error.value = t(`auth.register.errors.name.${nameProblem}`)
    return
  }

  if (password.value !== confirmPassword.value) {
    error.value = t('auth.errors.passwordsDoNotMatch')
    return
  }

  loading.value = true
  try {
    await register({
      username: username.value,
      name: name.value,
      email: email.value,
      password: password.value,
    })
  } catch (err) {
    error.value = resolveRegisterError(err)
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
        <h1 class="text-xl font-semibold text-foreground">{{ t('auth.register.title') }}</h1>
        <p class="text-sm text-muted-foreground mt-1">{{ t('auth.register.subtitle') }}</p>
      </div>

      <form class="space-y-4" @submit.prevent="handleSubmit">
        <div class="space-y-1.5">
          <label for="register-username" class="text-sm font-medium text-foreground">{{ t('auth.fields.username') }}</label>
          <input
            id="register-username"
            v-model="username"
            type="text"
            autocomplete="username"
            required
            minlength="3"
            maxlength="100"
            class="w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 backdrop-blur-sm"
          />
        </div>

        <div class="space-y-1.5">
          <label for="register-name" class="text-sm font-medium text-foreground">{{ t('auth.fields.fullName') }}</label>
          <input
            id="register-name"
            v-model="name"
            type="text"
            autocomplete="name"
            required
            maxlength="255"
            class="w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 backdrop-blur-sm"
          />
        </div>

        <div class="space-y-1.5">
          <label for="register-email" class="text-sm font-medium text-foreground">{{ t('auth.fields.email') }}</label>
          <input
            id="register-email"
            v-model="email"
            type="email"
            autocomplete="email"
            required
            class="w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 backdrop-blur-sm"
          />
        </div>

        <div class="space-y-1.5">
          <label for="register-password" class="text-sm font-medium text-foreground">{{ t('auth.fields.password') }}</label>
          <input
            id="register-password"
            v-model="password"
            type="password"
            autocomplete="new-password"
            required
            minlength="8"
            class="w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 backdrop-blur-sm"
          />
          <p class="text-xs text-muted-foreground">{{ t('auth.fields.passwordHint') }}</p>
        </div>

        <div class="space-y-1.5">
          <label for="register-confirm-password" class="text-sm font-medium text-foreground">{{ t('auth.fields.confirmPassword') }}</label>
          <input
            id="register-confirm-password"
            v-model="confirmPassword"
            type="password"
            autocomplete="new-password"
            required
            class="w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 backdrop-blur-sm"
          />
        </div>

        <div v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</div>

        <button
          type="submit"
          :disabled="loading"
          class="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {{ loading ? t('auth.register.creatingAccount') : t('auth.register.createAccount') }}
        </button>
      </form>

      <p class="mt-6 text-center text-sm text-muted-foreground">
        {{ t('auth.register.haveAccount') }}
        <RouterLink to="/login" class="text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
          {{ t('auth.register.signIn') }}
        </RouterLink>
      </p>
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
