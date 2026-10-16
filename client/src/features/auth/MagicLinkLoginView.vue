<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { CircleAlert, LoaderCircle } from '@lucide/vue'
import { useAuth } from '@/features/auth/composables/useAuth'
import AuthAlert from './components/AuthAlert.vue'
import AuthPlate from './components/AuthPlate.vue'

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
  <AuthPlate :heading="status === 'loading' ? t('auth.magicLink.signingIn') : t('auth.magicLink.loginFailed')">
    <div v-if="status === 'loading'" class="flex justify-center py-2" role="status" :aria-label="t('auth.magicLink.signingIn')">
      <LoaderCircle :size="24" class="animate-spin text-primary" aria-hidden="true" />
    </div>

    <template v-else>
      <AuthAlert :icon="CircleAlert">{{ errorMessage }}</AuthAlert>
      <p class="mt-[1.375rem] text-center font-serif text-[0.9375rem]">
        <button
          type="button"
          class="font-medium text-primary hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          @click="goToLogin"
        >
          {{ t('auth.magicLink.goToLogin') }}
        </button>
      </p>
    </template>
  </AuthPlate>
</template>
