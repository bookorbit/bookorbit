<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { ArrowRight, CircleAlert, CircleCheck, KeyRound, Lock, RefreshCw } from '@lucide/vue'
import { LoginErrorCode, type OidcProviderPublic } from '@bookorbit/types'
import { LoginError, useAuth } from './composables/useAuth'
import { useOidc } from './composables/useOidc'
import { useSetupStatus } from './composables/useSetupStatus'
import { useLoginOptions } from './composables/useLoginOptions'
import AuthAlert from './components/AuthAlert.vue'
import AuthField from './components/AuthField.vue'
import AuthPlate from './components/AuthPlate.vue'
import AuthSubmit from './components/AuthSubmit.vue'

const { t } = useI18n()
const { login } = useAuth()
const { initiateLogin } = useOidc()
const { setupStatusError, fetchSetupStatus } = useSetupStatus()
const { loginOptions, loginOptionsError, fetchLoginOptions } = useLoginOptions()
const passwordLoginEnabled = computed(() => loginOptions.value?.passwordLoginEnabled === true)
const allowRegistration = computed(() => loginOptions.value?.allowRegistration === true)

const route = useRoute()
const justRegistered = computed(() => route.query.registered === '1')
const justReset = computed(() => route.query.reset === '1')

const username = ref('')
const password = ref('')
const error = ref<string | null>(null)
const errorCode = ref<string | null>(null)
const credentialsRejected = ref(false)
const optionsFailed = ref(false)
const retrying = ref(false)
const loading = ref(false)
const oidcProviders = ref<OidcProviderPublic[]>([])
const oidcLoadingSlug = ref<string | null>(null)
const passwordField = ref<InstanceType<typeof AuthField> | null>(null)

const showOptionsError = computed(() => optionsFailed.value || setupStatusError.value !== null || loginOptionsError.value !== null)
const accountLocked = computed(() => errorCode.value === LoginErrorCode.ACCOUNT_LOCKED)

function resolveLoginError(err: unknown): string {
  if (!(err instanceof Error)) return t('auth.login.errors.invalidCredentials')

  if (err instanceof LoginError && err.errorCode === LoginErrorCode.PASSWORD_AUTH_DISABLED) {
    return t('auth.login.errors.passwordDisabled')
  }

  if (err instanceof LoginError && err.errorCode === LoginErrorCode.ACCOUNT_LOCKED) {
    const minutes = Math.max(1, Math.ceil((err.retryAfterSeconds ?? 0) / 60))
    return t('auth.login.errors.accountLocked', { minutes })
  }

  const normalizedMessage = err.message.trim().toLowerCase()
  if (normalizedMessage.includes('too many requests')) {
    return t('auth.login.errors.tooManyAttempts')
  }
  if (normalizedMessage.includes('invalid credentials')) {
    credentialsRejected.value = true
    return t('auth.login.errors.invalidCredentials')
  }

  return err.message || t('auth.login.errors.invalidCredentials')
}

async function loadOptions(force: boolean) {
  try {
    oidcProviders.value = (await fetchLoginOptions(force)).oidcProviders
    optionsFailed.value = false
  } catch {
    optionsFailed.value = true
  }
}

onMounted(() => loadOptions(false))

async function handleRetry() {
  retrying.value = true
  try {
    await Promise.allSettled([loadOptions(true), setupStatusError.value ? fetchSetupStatus(true) : Promise.resolve()])
  } finally {
    retrying.value = false
  }
}

async function handleSubmit() {
  error.value = null
  errorCode.value = null
  credentialsRejected.value = false
  loading.value = true
  try {
    await login(username.value, password.value)
  } catch (err) {
    errorCode.value = err instanceof LoginError ? (err.errorCode ?? null) : null
    error.value = resolveLoginError(err)
  } finally {
    loading.value = false
  }
  if (credentialsRejected.value) {
    // The field is still disabled from the request until the next render.
    await nextTick()
    passwordField.value?.focusAndSelect()
  }
}

async function handleOidcLogin(provider: OidcProviderPublic) {
  error.value = null
  errorCode.value = null
  oidcLoadingSlug.value = provider.slug
  try {
    await initiateLogin(provider)
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('auth.oidc.loginFailed')
    oidcLoadingSlug.value = null
  }
}
</script>

<template>
  <AuthPlate :heading="t('auth.login.subtitle')">
    <div class="flex flex-col gap-4">
      <AuthAlert v-if="justRegistered" tone="notice" :icon="CircleCheck">{{ t('auth.login.registeredNotice') }}</AuthAlert>
      <AuthAlert v-else-if="justReset" tone="notice" :icon="CircleCheck">{{ t('auth.login.resetNotice') }}</AuthAlert>

      <AuthAlert v-if="error" id="login-error" :icon="accountLocked ? Lock : CircleAlert">
        {{ error }}
        <template v-if="accountLocked && passwordLoginEnabled" #action>
          <RouterLink
            to="/forgot-password"
            class="inline-flex items-center gap-1 text-[0.78125rem] font-semibold underline decoration-foreground/35 underline-offset-[3px] hover:decoration-current focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {{ t('auth.login.resetPasswordAction') }}
            <ArrowRight :size="14" class="rtl:-scale-x-100" aria-hidden="true" />
          </RouterLink>
        </template>
      </AuthAlert>

      <AuthAlert v-if="showOptionsError" :icon="CircleAlert">
        {{ t('auth.login.errors.optionsUnavailable') }}
        <template #action>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 text-[0.78125rem] font-semibold underline decoration-foreground/35 underline-offset-[3px] hover:decoration-current focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-progress"
            :disabled="retrying"
            @click="handleRetry"
          >
            <RefreshCw :size="13" :class="{ 'animate-spin': retrying }" aria-hidden="true" />
            {{ t('common.retry') }}
          </button>
        </template>
      </AuthAlert>
    </div>

    <form
      v-if="passwordLoginEnabled"
      class="flex flex-col gap-[1.125rem]"
      :class="{ 'mt-[1.125rem]': error || showOptionsError || justRegistered || justReset }"
      @submit.prevent="handleSubmit"
    >
      <AuthField id="username" v-model="username" :label="t('auth.fields.username')" autocomplete="username" required :disabled="loading" />
      <AuthField
        id="password"
        ref="passwordField"
        v-model="password"
        :label="t('auth.fields.password')"
        type="password"
        autocomplete="current-password"
        required
        :disabled="loading"
        :invalid="credentialsRejected"
        :describedby="credentialsRejected ? 'login-error' : undefined"
      >
        <template #aside>
          <RouterLink
            to="/forgot-password"
            class="font-serif text-[0.84375rem] text-primary italic hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {{ t('auth.login.forgotPassword') }}
          </RouterLink>
        </template>
      </AuthField>

      <AuthSubmit :label="t('auth.login.signIn')" :loading-label="t('auth.login.signingIn')" :loading="loading" />
    </form>

    <template v-if="oidcProviders.length > 0">
      <div v-if="passwordLoginEnabled" class="my-5 flex items-center gap-3 font-serif text-sm text-muted-foreground italic">
        <span class="h-px flex-1 bg-border" />
        {{ t('auth.login.orDivider') }}
        <span class="h-px flex-1 bg-border" />
      </div>

      <div class="flex flex-col gap-2.5" :class="{ 'mt-1': !passwordLoginEnabled }">
        <button
          v-for="provider in oidcProviders"
          :key="provider.slug"
          type="button"
          :disabled="oidcLoadingSlug !== null"
          class="flex h-10 w-full items-center justify-center gap-2.5 rounded-[3px] border border-input px-4 text-sm font-medium text-foreground transition-colors hover:border-foreground/25 hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-progress disabled:opacity-70"
          @click="handleOidcLogin(provider)"
        >
          <span class="grid size-[1.375rem] shrink-0 place-items-center rounded-md bg-foreground/8">
            <img v-if="provider.iconUrl" :src="provider.iconUrl" alt="" class="size-4 object-contain" />
            <KeyRound v-else :size="13" aria-hidden="true" />
          </span>
          {{ oidcLoadingSlug === provider.slug ? t('auth.oidc.redirecting') : t('auth.oidc.signInWith', { provider: provider.displayName }) }}
        </button>
      </div>
    </template>

    <p v-if="allowRegistration" class="mt-[1.375rem] text-center font-serif text-[0.9375rem] text-muted-foreground">
      {{ t('auth.login.noAccount') }}
      <RouterLink
        to="/register"
        class="font-medium text-primary hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {{ t('auth.login.signUp') }}
      </RouterLink>
    </p>
  </AuthPlate>
</template>
