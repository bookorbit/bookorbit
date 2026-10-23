<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleAlert } from '@lucide/vue'
import AuthAlert from './components/AuthAlert.vue'
import AuthField from './components/AuthField.vue'
import AuthPlate from './components/AuthPlate.vue'
import AuthSubmit from './components/AuthSubmit.vue'
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
  <AuthPlate :heading="t('auth.register.title')" :description="t('auth.register.subtitle')" wide>
    <form class="flex flex-col gap-[1.125rem]" @submit.prevent="handleSubmit">
      <AuthAlert v-if="error" :icon="CircleAlert">{{ error }}</AuthAlert>
      <div class="grid gap-[1.125rem] sm:grid-cols-2">
        <AuthField
          id="register-username"
          v-model="username"
          :label="t('auth.fields.username')"
          autocomplete="username"
          required
          :minlength="3"
          :maxlength="100"
          :disabled="loading"
        />
        <AuthField
          id="register-name"
          v-model="name"
          :label="t('auth.fields.fullName')"
          autocomplete="name"
          required
          :maxlength="255"
          :disabled="loading"
        />
      </div>
      <AuthField id="register-email" v-model="email" :label="t('auth.fields.email')" type="email" autocomplete="email" required :disabled="loading" />
      <AuthField
        id="register-password"
        v-model="password"
        :label="t('auth.fields.password')"
        type="password"
        autocomplete="new-password"
        required
        :minlength="8"
        :hint="t('auth.fields.passwordHint')"
        :disabled="loading"
      />
      <AuthField
        id="register-confirm-password"
        v-model="confirmPassword"
        :label="t('auth.fields.confirmPassword')"
        type="password"
        autocomplete="new-password"
        required
        :disabled="loading"
      />
      <AuthSubmit :label="t('auth.register.createAccount')" :loading-label="t('auth.register.creatingAccount')" :loading="loading" />
    </form>

    <p class="mt-[1.375rem] text-center font-serif text-[0.9375rem] text-muted-foreground">
      {{ t('auth.register.haveAccount') }}
      <RouterLink
        to="/login"
        class="font-medium text-primary hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >{{ t('auth.register.signIn') }}</RouterLink
      >
    </p>
  </AuthPlate>
</template>
