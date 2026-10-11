<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { fetchWithAuthProxyRecovery } from '@/lib/api'
import PublicLegalNotices from '@/components/legal/PublicLegalNotices.vue'
import AuthAppearanceToolbar from './components/AuthAppearanceToolbar.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const token = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const error = ref<string | null>(null)
const loading = ref(false)

onMounted(() => {
  token.value = (route.query.token as string) ?? ''
  if (!token.value) {
    error.value = t('auth.resetPassword.errors.invalidLink')
  }
})

async function handleSubmit() {
  error.value = null

  if (newPassword.value !== confirmPassword.value) {
    error.value = t('auth.errors.passwordsDoNotMatch')
    return
  }

  loading.value = true
  try {
    const res = await fetchWithAuthProxyRecovery('/api/v1/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token.value, newPassword: newPassword.value }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      error.value = err.message ?? t('auth.resetPassword.errors.invalidOrExpired')
      return
    }

    router.push({ path: '/login', query: { reset: '1' } })
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
        <p class="text-sm text-muted-foreground mt-1">{{ t('auth.resetPassword.subtitle') }}</p>
      </div>

      <form @submit.prevent="handleSubmit" class="space-y-4">
        <div class="space-y-1.5">
          <label for="newPassword" class="text-sm font-medium text-foreground">{{ t('auth.fields.newPassword') }}</label>
          <input
            id="newPassword"
            v-model="newPassword"
            type="password"
            autocomplete="new-password"
            required
            class="w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 backdrop-blur-sm"
          />
          <p class="text-xs text-muted-foreground">{{ t('auth.fields.passwordHint') }}</p>
        </div>

        <div class="space-y-1.5">
          <label for="confirmPassword" class="text-sm font-medium text-foreground">{{ t('auth.fields.confirmPassword') }}</label>
          <input
            id="confirmPassword"
            v-model="confirmPassword"
            type="password"
            autocomplete="new-password"
            required
            class="w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 backdrop-blur-sm"
          />
        </div>

        <div v-if="error" class="text-sm text-destructive">{{ error }}</div>

        <button
          type="submit"
          :disabled="loading || !token"
          class="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {{ loading ? t('auth.resetPassword.saving') : t('auth.resetPassword.setNewPassword') }}
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
