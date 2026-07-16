<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import type { OidcCallbackResponse } from '@bookorbit/types'
import { OidcErrorCode } from '@bookorbit/types'
import { setAccessToken } from '@/lib/api'
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
  <div class="min-h-screen flex items-center justify-center bg-background px-4">
    <div class="w-full max-w-sm text-center">
      <h1 class="text-2xl font-serif font-semibold text-foreground mb-6">Book<span class="text-primary"> Orbit</span></h1>

      <div v-if="!error" class="space-y-3">
        <div class="flex justify-center">
          <div class="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
        <p class="text-sm text-muted-foreground">{{ t('auth.oidc.completingSignIn') }}</p>
      </div>

      <div v-else class="space-y-4">
        <p class="text-sm text-destructive">{{ error }}</p>
        <RouterLink to="/login" class="text-sm text-primary hover:underline">{{ t('auth.oidc.tryAgain') }}</RouterLink>
      </div>
    </div>
  </div>
</template>
