<script setup lang="ts">
import { ref } from 'vue'
import { X } from 'lucide-vue-next'
import { api } from '@/lib/api'
import { useAuth } from './composables/useAuth'
import { useChangePasswordDialog } from '@/composables/useChangePasswordDialog'

const { me } = useAuth()
const { isForced, close } = useChangePasswordDialog()

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const error = ref<string | null>(null)
const loading = ref(false)

async function handleSubmit() {
  error.value = null

  if (newPassword.value !== confirmPassword.value) {
    error.value = 'Passwords do not match'
    return
  }

  loading.value = true
  try {
    const res = await api('/api/v1/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: currentPassword.value, newPassword: newPassword.value }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      error.value = err.message ?? 'Failed to change password'
      return
    }

    // After password change, token version increments — re-login is required.
    // me() will 401, triggering onAuthFailure which redirects to /login.
    await me().catch(() => {})
    close()
  } catch {
    error.value = 'Something went wrong. Please try again.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4">
      <div class="w-full max-w-sm rounded-lg border border-border bg-card shadow-xl p-6">
        <div class="flex items-center justify-between mb-5">
          <h2 class="text-base font-semibold text-foreground">Change password</h2>
          <button v-if="!isForced" @click="close" class="text-muted-foreground hover:text-foreground transition-colors">
            <X :size="16" />
          </button>
        </div>

        <div v-if="isForced" class="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          You must set a new password before continuing.
        </div>

        <form @submit.prevent="handleSubmit" class="space-y-4">
          <div class="space-y-1.5">
            <label for="cp-current" class="text-sm font-medium text-foreground">Current password</label>
            <input
              id="cp-current"
              v-model="currentPassword"
              type="password"
              autocomplete="current-password"
              required
              class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div class="space-y-1.5">
            <label for="cp-new" class="text-sm font-medium text-foreground">New password</label>
            <input
              id="cp-new"
              v-model="newPassword"
              type="password"
              autocomplete="new-password"
              required
              class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <p class="text-xs text-muted-foreground">Min. 8 characters with uppercase, lowercase, and a digit</p>
          </div>

          <div class="space-y-1.5">
            <label for="cp-confirm" class="text-sm font-medium text-foreground">Confirm new password</label>
            <input
              id="cp-confirm"
              v-model="confirmPassword"
              type="password"
              autocomplete="new-password"
              required
              class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div v-if="error" class="text-sm text-destructive">{{ error }}</div>

          <div class="flex gap-3 justify-end pt-1">
            <button
              v-if="!isForced"
              type="button"
              @click="close"
              class="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              :disabled="loading"
              class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {{ loading ? 'Saving…' : 'Change password' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>
