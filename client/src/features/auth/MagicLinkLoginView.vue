<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { Loader2, AlertCircle } from '@lucide/vue'
import { useAuth } from '@/features/auth/composables/useAuth'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { loginWithMagicLink } = useAuth()

const status = ref<'loading' | 'error'>('loading')
const errorMessage = ref('')

onMounted(async () => {
  const token = route.query.token as string | undefined

  // Strip token from URL immediately to prevent leaks via browser history/referrer
  if (route.query.token) {
    router.replace({ path: '/magic', query: {} })
  }

  if (!token) {
    status.value = 'error'
    errorMessage.value = t('auth.magicLink.errors.noToken')
    return
  }

  try {
    await loginWithMagicLink(token)
  } catch (e) {
    status.value = 'error'
    errorMessage.value = e instanceof Error ? e.message : t('auth.magicLink.loginFailed')
  }
})

function goToLogin() {
  router.push('/login')
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-background px-4">
    <div class="w-full max-w-sm text-center">
      <div v-if="status === 'loading'" class="space-y-4">
        <Loader2 :size="32" class="mx-auto text-primary animate-spin" />
        <p class="text-sm text-muted-foreground">{{ t('auth.magicLink.signingIn') }}</p>
      </div>

      <div v-else class="space-y-4">
        <div class="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
          <AlertCircle :size="24" class="text-destructive" />
        </div>
        <div>
          <p class="text-base font-semibold text-foreground">{{ t('auth.magicLink.loginFailed') }}</p>
          <p class="mt-1 text-sm text-muted-foreground">{{ errorMessage }}</p>
        </div>
        <button
          class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          @click="goToLogin"
        >
          {{ t('auth.magicLink.goToLogin') }}
        </button>
      </div>
    </div>
  </div>
</template>
