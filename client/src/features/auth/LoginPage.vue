<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { LoginErrorCode, type OidcProviderPublic } from '@bookorbit/types'
import { LoginError, useAuth } from './composables/useAuth'
import { useOidc } from './composables/useOidc'
import { useSetupStatus } from './composables/useSetupStatus'
import { useLoginOptions } from './composables/useLoginOptions'
import PublicLegalNotices from '@/components/legal/PublicLegalNotices.vue'
import AuthAppearanceToolbar from './components/AuthAppearanceToolbar.vue'

const { t } = useI18n()
const { login } = useAuth()
const { initiateLogin } = useOidc()
const { setupStatusError } = useSetupStatus()
const { loginOptions, loginOptionsError, fetchLoginOptions } = useLoginOptions()
const passwordLoginEnabled = computed(() => loginOptions.value?.passwordLoginEnabled === true)
const allowRegistration = computed(() => loginOptions.value?.allowRegistration === true)

const route = useRoute()
const justRegistered = computed(() => route.query.registered === '1')

const username = ref('')
const password = ref('')
const error = ref<string | null>(null)
const loading = ref(false)
const oidcProviders = ref<OidcProviderPublic[]>([])
const oidcLoadingSlug = ref<string | null>(null)

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
    return t('auth.login.errors.invalidCredentials')
  }

  return err.message || t('auth.login.errors.invalidCredentials')
}

onMounted(async () => {
  try {
    oidcProviders.value = (await fetchLoginOptions()).oidcProviders
  } catch {
    error.value = t('auth.login.errors.optionsUnavailable')
  }
})

async function handleSubmit() {
  error.value = null
  loading.value = true
  try {
    await login(username.value, password.value)
  } catch (err) {
    error.value = resolveLoginError(err)
  } finally {
    loading.value = false
  }
}

async function handleOidcLogin(provider: OidcProviderPublic) {
  error.value = null
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
  <div class="login-bg min-h-screen flex flex-col items-center justify-center gap-3 px-4 overflow-hidden">
    <AuthAppearanceToolbar placement="top" />

    <div class="login-card relative z-10 w-full max-w-sm rounded-2xl p-8">
      <div class="text-center mb-8 animate-fade-up">
        <h1 class="text-2xl font-serif font-semibold text-foreground">Book<span class="text-primary"> Orbit</span></h1>
        <p class="text-sm text-muted-foreground mt-1">{{ t('auth.login.subtitle') }}</p>
      </div>

      <div v-if="justRegistered" role="status" class="mb-4 rounded-md border border-primary/30 bg-primary/10 px-3 py-2.5 text-sm text-foreground">
        {{ t('auth.login.registeredNotice') }}
      </div>

      <form v-if="passwordLoginEnabled" @submit.prevent="handleSubmit" class="space-y-4">
        <div class="space-y-1.5 animate-fade-up" style="animation-delay: 80ms">
          <label for="username" class="text-sm font-medium text-foreground">{{ t('auth.fields.username') }}</label>
          <input
            id="username"
            v-model="username"
            type="text"
            autocomplete="username"
            required
            class="w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 backdrop-blur-sm"
          />
        </div>

        <div class="space-y-1.5 animate-fade-up" style="animation-delay: 160ms">
          <label for="password" class="text-sm font-medium text-foreground">{{ t('auth.fields.password') }}</label>
          <input
            id="password"
            v-model="password"
            type="password"
            autocomplete="current-password"
            required
            class="w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 backdrop-blur-sm"
          />
        </div>

        <div v-if="error" role="alert" class="text-sm text-destructive animate-shake">{{ error }}</div>
        <div v-if="setupStatusError || loginOptionsError" class="text-sm text-destructive animate-shake">
          {{ t('auth.login.errors.optionsUnavailable') }}
        </div>

        <button
          type="submit"
          :disabled="loading"
          class="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors animate-fade-up"
          style="animation-delay: 240ms"
        >
          {{ loading ? t('auth.login.signingIn') : t('auth.login.signIn') }}
        </button>
      </form>

      <template v-if="oidcProviders.length > 0">
        <div v-if="passwordLoginEnabled" class="flex items-center gap-3 my-6">
          <div class="flex-1 h-px bg-border" />
          <span class="text-sm text-muted-foreground">{{ t('auth.login.orDivider') }}</span>
          <div class="flex-1 h-px bg-border" />
        </div>

        <div class="space-y-3" :class="passwordLoginEnabled ? '' : 'mt-2'">
          <button
            v-for="provider in oidcProviders"
            :key="provider.slug"
            type="button"
            :disabled="oidcLoadingSlug !== null"
            class="flex w-full items-center justify-center gap-2 rounded-md border border-input bg-background/60 px-4 py-2 text-[14px] font-medium text-foreground hover:bg-muted/60 disabled:opacity-50 transition-colors backdrop-blur-sm"
            @click="handleOidcLogin(provider)"
          >
            <img v-if="provider.iconUrl" :src="provider.iconUrl" alt="" class="h-4 w-4 shrink-0 object-contain" />
            {{ oidcLoadingSlug === provider.slug ? t('auth.oidc.redirecting') : t('auth.oidc.signInWith', { provider: provider.displayName }) }}
          </button>
        </div>
      </template>

      <p v-if="passwordLoginEnabled" class="mt-6 text-center text-sm text-muted-foreground">
        <RouterLink to="/forgot-password" class="text-primary hover:underline">{{ t('auth.login.forgotPassword') }}</RouterLink>
      </p>

      <p v-if="allowRegistration" class="mt-2 text-center text-sm text-muted-foreground">
        {{ t('auth.login.noAccount') }}
        <RouterLink to="/register" class="text-primary hover:underline">{{ t('auth.login.signUp') }}</RouterLink>
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
