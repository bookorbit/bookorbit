<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import type { OidcCallbackResponse } from '@bookorbit/types'
import { OidcErrorCode } from '@bookorbit/types'
import { setAccessToken } from '@/lib/api'
import { CircleAlert, LoaderCircle } from '@lucide/vue'
import AuthAlert from './components/AuthAlert.vue'
import AuthPlate from './components/AuthPlate.vue'
import { useAuth } from './composables/useAuth'
import { useOidc, OidcLoginError } from './composables/useOidc'

const { t } = useI18n()

const OIDC_ERROR_MESSAGE_KEYS: Record<string, string> = {
  [OidcErrorCode.STATE_EXPIRED]: 'auth.oidc.errors.stateExpired',
  [OidcErrorCode.TOKEN_EXCHANGE_FAILED]: 'auth.oidc.errors.tokenExchangeFailed',
  [OidcErrorCode.USER_NOT_PROVISIONED]: 'auth.oidc.errors.userNotProvisioned',
  [OidcErrorCode.USER_INACTIVE]: 'auth.oidc.errors.userInactive',
  [OidcErrorCode.PROVIDER_ERROR]: 'auth.oidc.errors.providerError',
}

const PROVIDER_ERROR_DESCRIPTION_KEYS: Record<string, string> = {
  access_denied: 'auth.oidc.providerErrors.accessDenied',
  login_required: 'auth.oidc.providerErrors.loginRequired',
  interaction_required: 'auth.oidc.providerErrors.interactionRequired',
}

const router = useRouter()
const { user } = useAuth()
const { exchangeCode } = useOidc()
const error = ref<string | null>(null)

onMounted(async () => {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const state = params.get('state')
  const errorParam = params.get('error')

  if (errorParam) {
    const description = params.get('error_description')
    const descriptionKey = PROVIDER_ERROR_DESCRIPTION_KEYS[errorParam]
    error.value = descriptionKey ? t(descriptionKey) : (description ?? t('auth.oidc.errors.providerError'))
    return
  }

  if (!code || !state) {
    error.value = t('auth.oidc.errors.missingCodeOrState')
    return
  }

  try {
    const data: OidcCallbackResponse = await exchangeCode(code, state)

    if (data.mode === 'login') {
      setAccessToken(data.accessToken)
      user.value = data.user
      const redirect = sessionStorage.getItem('oidc_redirect') ?? '/'
      sessionStorage.removeItem('oidc_redirect')
      router.replace(redirect)
      return
    }

    if (data.mode === 'link') {
      sessionStorage.removeItem('oidc_link_pending')
      router.replace('/settings/account')
      return
    }

    if (data.mode === 'preview') {
      sessionStorage.setItem('oidc_preview_claims', JSON.stringify(data.claims))
      router.replace('/settings/admin/oidc')
      return
    }
  } catch (err) {
    const messageKey = err instanceof OidcLoginError && err.errorCode ? OIDC_ERROR_MESSAGE_KEYS[err.errorCode] : undefined
    if (messageKey) {
      error.value = t(messageKey)
    } else {
      error.value = err instanceof Error ? err.message : t('auth.oidc.loginFailed')
    }
  }
})
</script>

<template>
  <AuthPlate :heading="error ? t('auth.oidc.loginFailed') : t('auth.oidc.completingSignIn')">
    <div v-if="!error" class="flex justify-center py-2" role="status" :aria-label="t('auth.oidc.completingSignIn')">
      <LoaderCircle :size="24" class="animate-spin text-primary" aria-hidden="true" />
    </div>

    <template v-else>
      <AuthAlert :icon="CircleAlert">{{ error }}</AuthAlert>
      <p class="mt-[1.375rem] text-center font-serif text-[0.9375rem]">
        <RouterLink
          to="/login"
          class="font-medium text-primary hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >{{ t('auth.oidc.tryAgain') }}</RouterLink
        >
      </p>
    </template>
  </AuthPlate>
</template>
