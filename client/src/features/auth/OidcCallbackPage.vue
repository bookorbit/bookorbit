<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { OidcCallbackResponse } from '@projectx/types'
import { OidcErrorCode } from '@projectx/types'
import { setAccessToken } from '@/lib/api'
import { useAuth } from './composables/useAuth'
import { useOidc, OidcLoginError } from './composables/useOidc'

const OIDC_ERROR_MESSAGES: Record<string, string> = {
  [OidcErrorCode.STATE_EXPIRED]: 'Your login session expired. Please try signing in again.',
  [OidcErrorCode.TOKEN_EXCHANGE_FAILED]: 'Could not complete sign-in with your provider. Please try again or contact your administrator.',
  [OidcErrorCode.USER_NOT_PROVISIONED]: 'Your account has not been set up. Contact your administrator for access.',
  [OidcErrorCode.USER_INACTIVE]: 'Your account has been deactivated. Contact your administrator.',
  [OidcErrorCode.PROVIDER_ERROR]: 'Your identity provider returned an error. Please try again.',
}

const PROVIDER_ERROR_DESCRIPTIONS: Record<string, string> = {
  access_denied: 'Access was denied by the identity provider.',
  login_required: 'Authentication is required. Please sign in again.',
  interaction_required: 'Additional user interaction is required.',
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
    error.value = PROVIDER_ERROR_DESCRIPTIONS[errorParam] ?? description ?? 'Your identity provider returned an error. Please try again.'
    return
  }

  if (!code || !state) {
    error.value = 'Missing code or state parameter'
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
    if (err instanceof OidcLoginError && err.errorCode && OIDC_ERROR_MESSAGES[err.errorCode]) {
      error.value = OIDC_ERROR_MESSAGES[err.errorCode]
    } else {
      error.value = err instanceof Error ? err.message : 'OIDC login failed'
    }
  }
})
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-background px-4">
    <div class="w-full max-w-sm text-center">
      <h1 class="text-2xl font-serif font-semibold text-foreground mb-6">project<span class="text-primary">x</span></h1>

      <div v-if="!error" class="space-y-3">
        <div class="flex justify-center">
          <div class="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
        <p class="text-sm text-muted-foreground">Completing sign in...</p>
      </div>

      <div v-else class="space-y-4">
        <p class="text-sm text-destructive">{{ error }}</p>
        <RouterLink to="/login" class="text-sm text-primary hover:underline">Try again</RouterLink>
      </div>
    </div>
  </div>
</template>
