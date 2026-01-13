<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { AuthResponse } from '@projectx/types'
import { setAccessToken } from '@/lib/api'
import { useAuth } from './composables/useAuth'
import { useOidc } from './composables/useOidc'

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
    error.value = params.get('error_description') ?? 'OIDC provider returned an error'
    return
  }

  if (!code || !state) {
    error.value = 'Missing code or state parameter'
    return
  }

  try {
    const data: AuthResponse = await exchangeCode(code, state)
    setAccessToken(data.accessToken)
    user.value = data.user

    const redirect = sessionStorage.getItem('oidc_redirect') ?? '/'
    sessionStorage.removeItem('oidc_redirect')
    router.replace(redirect)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'OIDC login failed'
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
        <RouterLink to="/login" class="text-sm text-primary hover:underline">Back to login</RouterLink>
      </div>
    </div>
  </div>
</template>
