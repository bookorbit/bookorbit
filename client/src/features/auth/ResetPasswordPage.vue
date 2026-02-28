<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

const token = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const error = ref<string | null>(null)
const loading = ref(false)

onMounted(() => {
  token.value = (route.query.token as string) ?? ''
  if (!token.value) {
    error.value = 'Invalid reset link. Please request a new one.'
  }
})

async function handleSubmit() {
  error.value = null

  if (newPassword.value !== confirmPassword.value) {
    error.value = 'Passwords do not match'
    return
  }

  loading.value = true
  try {
    const res = await fetch('/api/v1/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token.value, newPassword: newPassword.value }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      error.value = err.message ?? 'Invalid or expired reset link. Please request a new one.'
      return
    }

    router.push({ path: '/login', query: { reset: '1' } })
  } catch {
    error.value = 'Something went wrong. Please try again.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-background px-4">
    <div class="w-full max-w-sm">
      <div class="text-center mb-8">
        <h1 class="text-2xl font-serif font-semibold text-foreground">project<span class="text-primary">x</span></h1>
        <p class="text-sm text-muted-foreground mt-1">Set a new password</p>
      </div>

      <form @submit.prevent="handleSubmit" class="space-y-4">
        <div class="space-y-1.5">
          <label for="newPassword" class="text-sm font-medium text-foreground">New password</label>
          <input
            id="newPassword"
            v-model="newPassword"
            type="password"
            autocomplete="new-password"
            required
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <p class="text-xs text-muted-foreground">Min. 8 characters with uppercase, lowercase, and a digit</p>
        </div>

        <div class="space-y-1.5">
          <label for="confirmPassword" class="text-sm font-medium text-foreground">Confirm password</label>
          <input
            id="confirmPassword"
            v-model="confirmPassword"
            type="password"
            autocomplete="new-password"
            required
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        <div v-if="error" class="text-sm text-destructive">{{ error }}</div>

        <button
          type="submit"
          :disabled="loading || !token"
          class="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {{ loading ? 'Saving…' : 'Set new password' }}
        </button>
      </form>

      <p class="mt-4 text-center text-sm text-muted-foreground">
        <RouterLink to="/login" class="text-primary hover:underline">Back to sign in</RouterLink>
      </p>
    </div>
  </div>
</template>
