<script setup lang="ts">
import { ref } from 'vue'
import { useAuth } from './composables/useAuth'

const { setup } = useAuth()

const username = ref('')
const name = ref('')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const setupToken = ref('')

const loading = ref(false)
const error = ref<string | null>(null)

async function handleSubmit() {
  error.value = null

  if (password.value !== confirmPassword.value) {
    error.value = 'Passwords do not match'
    return
  }

  loading.value = true
  try {
    await setup({
      username: username.value,
      name: name.value,
      email: email.value,
      password: password.value,
      setupToken: setupToken.value || undefined,
    })
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to complete setup'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-background px-4">
    <div class="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm">
      <div class="mb-6">
        <h1 class="text-xl font-semibold text-foreground">Initial setup</h1>
        <p class="text-sm text-muted-foreground mt-1">Create the first administrator account.</p>
      </div>

      <form class="space-y-4" @submit.prevent="handleSubmit">
        <div class="space-y-1.5">
          <label for="setup-username" class="text-sm font-medium text-foreground">Username</label>
          <input
            id="setup-username"
            v-model="username"
            type="text"
            autocomplete="username"
            required
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        <div class="space-y-1.5">
          <label for="setup-name" class="text-sm font-medium text-foreground">Full name</label>
          <input
            id="setup-name"
            v-model="name"
            type="text"
            autocomplete="name"
            required
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        <div class="space-y-1.5">
          <label for="setup-email" class="text-sm font-medium text-foreground">Email</label>
          <input
            id="setup-email"
            v-model="email"
            type="email"
            autocomplete="email"
            required
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        <div class="space-y-1.5">
          <label for="setup-password" class="text-sm font-medium text-foreground">Password</label>
          <input
            id="setup-password"
            v-model="password"
            type="password"
            autocomplete="new-password"
            required
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <p class="text-xs text-muted-foreground">Min. 8 characters with uppercase, lowercase, and a digit</p>
        </div>

        <div class="space-y-1.5">
          <label for="setup-confirm-password" class="text-sm font-medium text-foreground">Confirm password</label>
          <input
            id="setup-confirm-password"
            v-model="confirmPassword"
            type="password"
            autocomplete="new-password"
            required
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        <div class="space-y-1.5">
          <label for="setup-token" class="text-sm font-medium text-foreground">
            Setup token
            <span class="text-muted-foreground">(required in production)</span>
          </label>
          <input
            id="setup-token"
            v-model="setupToken"
            type="text"
            autocomplete="off"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        <div v-if="error" class="text-sm text-destructive">{{ error }}</div>

        <button
          type="submit"
          :disabled="loading"
          class="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {{ loading ? 'Creating account…' : 'Create administrator account' }}
        </button>
      </form>
    </div>
  </div>
</template>
