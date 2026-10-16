<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleAlert } from '@lucide/vue'
import AuthAlert from './components/AuthAlert.vue'
import AuthField from './components/AuthField.vue'
import AuthPlate from './components/AuthPlate.vue'
import AuthSubmit from './components/AuthSubmit.vue'
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
  <AuthPlate :heading="t('auth.setup.title')" :description="t('auth.setup.subtitle')" wide>
    <form class="flex flex-col gap-[1.125rem]" @submit.prevent="handleSubmit">
      <AuthAlert v-if="error" :icon="CircleAlert">{{ error }}</AuthAlert>
      <div class="grid gap-[1.125rem] sm:grid-cols-2">
        <AuthField id="setup-username" v-model="username" :label="t('auth.fields.username')" autocomplete="username" required :disabled="loading" />
        <AuthField id="setup-name" v-model="name" :label="t('auth.fields.fullName')" autocomplete="name" required :disabled="loading" />
      </div>
      <AuthField id="setup-email" v-model="email" :label="t('auth.fields.email')" type="email" autocomplete="email" required :disabled="loading" />
      <AuthField
        id="setup-password"
        v-model="password"
        :label="t('auth.fields.password')"
        type="password"
        autocomplete="new-password"
        required
        :hint="t('auth.fields.passwordHint')"
        :disabled="loading"
      />
      <AuthField
        id="setup-confirm-password"
        v-model="confirmPassword"
        :label="t('auth.fields.confirmPassword')"
        type="password"
        autocomplete="new-password"
        required
        :disabled="loading"
      />
      <AuthField id="setup-token" v-model="setupToken" :label="t('auth.setup.setupToken')" autocomplete="off" :disabled="loading">
        <template #aside>
          <span class="text-xs text-muted-foreground">{{ t('auth.setup.setupTokenHint') }}</span>
        </template>
      </AuthField>
      <AuthSubmit :label="t('auth.setup.createAccount')" :loading-label="t('auth.setup.creatingAccount')" :loading="loading" />
    </form>
  </AuthPlate>
</template>
