<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Loader2, AlertCircle } from 'lucide-vue-next'
import { useAuth } from '@/features/auth/composables/useAuth'

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
    errorMessage.value = 'No token provided'
    return
  }

  try {
    await loginWithMagicLink(token)
  } catch (e) {
    status.value = 'error'
    errorMessage.value = e instanceof Error ? e.message : 'Login failed'
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
        <p class="text-sm text-muted-foreground">Signing you in...</p>
      </div>

      <div v-else class="space-y-4">
        <div class="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
          <AlertCircle :size="24" class="text-destructive" />
        </div>
        <div>
          <p class="text-base font-semibold text-foreground">Login failed</p>
          <p class="mt-1 text-sm text-muted-foreground">{{ errorMessage }}</p>
        </div>
        <button
          class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          @click="goToLogin"
        >
          Go to login
        </button>
      </div>
    </div>
  </div>
</template>
