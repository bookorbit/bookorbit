<script setup lang="ts">
import { ref } from 'vue'
import { api } from '@/lib/api'

const email = ref('')
const submitted = ref(false)
const error = ref<string | null>(null)
const loading = ref(false)

async function handleSubmit() {
  error.value = null
  loading.value = true
  try {
    const res = await api('/api/v1/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.value }),
    })
    if (res.status === 503) {
      error.value = 'Password reset via email is not available. Contact your administrator.'
      return
    }
    submitted.value = true
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
        <p class="text-sm text-muted-foreground mt-1">Reset your password</p>
      </div>

      <div v-if="submitted" class="rounded-md border border-border bg-card p-4 text-sm text-foreground">
        If an account with that email exists, a reset link has been sent. Check your inbox.
      </div>

      <form v-else @submit.prevent="handleSubmit" class="space-y-4">
        <div class="space-y-1.5">
          <label for="email" class="text-sm font-medium text-foreground">Email address</label>
          <input
            id="email"
            v-model="email"
            type="email"
            autocomplete="email"
            required
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        <div v-if="error" class="text-sm text-destructive">{{ error }}</div>

        <button
          type="submit"
          :disabled="loading"
          class="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {{ loading ? 'Sending…' : 'Send reset link' }}
        </button>
      </form>

      <p class="mt-4 text-center text-sm text-muted-foreground">
        <RouterLink to="/login" class="text-primary hover:underline">Back to sign in</RouterLink>
      </p>
    </div>
  </div>
</template>
