<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/lib/api'
import PublicLegalNotices from '@/components/legal/PublicLegalNotices.vue'
import AuthAppearanceToolbar from './components/AuthAppearanceToolbar.vue'

const { t } = useI18n()
const email = ref('')
const submitted = ref(false)
const error = ref<string | null>(null)
const loading = ref(false)

async function handleSubmit() {
  error.value = null
  loading.value = true
  try {
    const res = await api('/api/v1/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.value }),
    })
    if (res.status === 503) {
      error.value = t('auth.forgotPassword.errors.emailUnavailable')
      return
    }
    submitted.value = true
  } catch {
    error.value = t('auth.errors.generic')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-bg min-h-screen flex flex-col items-center justify-center gap-3 px-4 overflow-hidden">
    <AuthAppearanceToolbar placement="bottom" />

    <div class="login-card relative z-10 w-full max-w-sm rounded-2xl p-8">
      <div class="text-center mb-8">
        <h1 class="text-2xl font-serif font-semibold text-foreground">Book<span class="text-primary"> Orbit</span></h1>
        <p class="text-sm text-muted-foreground mt-1">{{ t('auth.forgotPassword.subtitle') }}</p>
      </div>

      <div v-if="submitted" class="rounded-md border border-border bg-card/60 backdrop-blur-sm p-4 text-sm text-foreground">
        {{ t('auth.forgotPassword.submitted') }}
      </div>

      <form v-else @submit.prevent="handleSubmit" class="space-y-4">
        <div class="space-y-1.5">
          <label for="email" class="text-sm font-medium text-foreground">{{ t('auth.fields.emailAddress') }}</label>
          <input
            id="email"
            v-model="email"
            type="email"
            autocomplete="email"
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
          {{ loading ? t('auth.forgotPassword.sending') : t('auth.forgotPassword.sendResetLink') }}
        </button>
      </form>

      <p class="mt-4 text-center text-sm text-muted-foreground">
        <RouterLink to="/login" class="text-primary hover:underline">{{ t('auth.backToSignIn') }}</RouterLink>
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
