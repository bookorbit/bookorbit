<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, CircleAlert, Mail } from '@lucide/vue'
import { api } from '@/lib/api'
import AuthAlert from './components/AuthAlert.vue'
import AuthField from './components/AuthField.vue'
import AuthPlate from './components/AuthPlate.vue'
import AuthSubmit from './components/AuthSubmit.vue'

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
  <AuthPlate :heading="t('auth.forgotPassword.subtitle')">
    <AuthAlert v-if="submitted" tone="notice" :icon="Mail">{{ t('auth.forgotPassword.submitted') }}</AuthAlert>

    <form v-else class="flex flex-col gap-[1.125rem]" @submit.prevent="handleSubmit">
      <AuthAlert v-if="error" :icon="CircleAlert">{{ error }}</AuthAlert>
      <AuthField id="email" v-model="email" :label="t('auth.fields.emailAddress')" type="email" autocomplete="email" required :disabled="loading" />
      <AuthSubmit :label="t('auth.forgotPassword.sendResetLink')" :loading-label="t('auth.forgotPassword.sending')" :loading="loading" />
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
