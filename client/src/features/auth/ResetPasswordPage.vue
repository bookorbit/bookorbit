<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, CircleAlert } from '@lucide/vue'
import { useRoute, useRouter } from 'vue-router'
import { fetchWithAuthProxyRecovery } from '@/lib/api'
import AuthAlert from './components/AuthAlert.vue'
import AuthField from './components/AuthField.vue'
import AuthPlate from './components/AuthPlate.vue'
import AuthSubmit from './components/AuthSubmit.vue'

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
  <AuthPlate :heading="t('auth.resetPassword.subtitle')">
    <form class="flex flex-col gap-[1.125rem]" @submit.prevent="handleSubmit">
      <AuthAlert v-if="error" :icon="CircleAlert">{{ error }}</AuthAlert>
      <AuthField
        id="newPassword"
        v-model="newPassword"
        :label="t('auth.fields.newPassword')"
        type="password"
        autocomplete="new-password"
        required
        :hint="t('auth.fields.passwordHint')"
        :disabled="loading"
      />
      <AuthField
        id="confirmPassword"
        v-model="confirmPassword"
        :label="t('auth.fields.confirmPassword')"
        type="password"
        autocomplete="new-password"
        required
        :disabled="loading"
      />
      <AuthSubmit
        :label="t('auth.resetPassword.setNewPassword')"
        :loading-label="t('auth.resetPassword.saving')"
        :loading="loading"
        :disabled="!token"
      />
    </form>

    <p class="mt-[1.375rem] text-center font-serif text-[0.9375rem] text-muted-foreground">
      <RouterLink
        to="/login"
        class="inline-flex items-center gap-1.5 font-medium text-primary hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <ArrowLeft :size="14" class="rtl:-scale-x-100" aria-hidden="true" />
        {{ t('auth.backToSignIn') }}
      </RouterLink>
    </p>
  </AuthPlate>
</template>
