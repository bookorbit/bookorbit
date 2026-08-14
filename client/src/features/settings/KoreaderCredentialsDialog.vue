<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Eye, EyeOff, Loader2 } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import type { UpdateKoreaderCredentialsPayload } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { SECRET_INPUT_ATTRS } from '@/lib/secret-input'

const props = defineProps<{
  open: boolean
  currentUsername: string
  saving: boolean
  error: string | null
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  submit: [payload: UpdateKoreaderCredentialsPayload]
}>()

const { t } = useI18n()
const username = ref('')
const password = ref('')
const showPassword = ref(false)

const trimmedUsername = computed(() => username.value.trim())
const usernameValid = computed(() => trimmedUsername.value.length >= 3 && trimmedUsername.value.length <= 100)
const passwordValid = computed(() => password.value.length === 0 || (password.value.length >= 6 && password.value.length <= 128))
const changed = computed(() => trimmedUsername.value !== props.currentUsername || password.value.length > 0)
const canSave = computed(() => !props.saving && usernameValid.value && passwordValid.value && changed.value)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    username.value = props.currentUsername
    password.value = ''
    showPassword.value = false
  },
  { immediate: true },
)

function handleOpenChange(open: boolean): void {
  if (!open && !props.saving) emit('update:open', false)
}

function handleCancel(): void {
  if (!props.saving) emit('update:open', false)
}

function handleTogglePassword(): void {
  showPassword.value = !showPassword.value
}

function handleSubmit(): void {
  if (!canSave.value) return

  const payload: UpdateKoreaderCredentialsPayload = {}
  if (trimmedUsername.value !== props.currentUsername) payload.username = trimmedUsername.value
  if (password.value) payload.password = password.value
  emit('submit', payload)
}
</script>

<template>
  <DialogRoot :open="props.open" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-foreground/50" />
      <DialogContent
        aria-modal="true"
        class="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <DialogTitle class="text-lg font-semibold text-foreground">
          {{ t('settings.reader.koreader.changeCredentials.title') }}
        </DialogTitle>
        <DialogDescription class="mt-1 text-sm text-muted-foreground">
          {{ t('settings.reader.koreader.changeCredentials.description') }}
        </DialogDescription>

        <form class="mt-5 space-y-4" @submit.prevent="handleSubmit">
          <div>
            <label for="koreader-credentials-username" class="mb-1.5 block text-sm font-medium text-foreground">
              {{ t('settings.reader.koreader.username') }}
            </label>
            <input
              id="koreader-credentials-username"
              v-model="username"
              type="text"
              minlength="3"
              maxlength="100"
              autocomplete="off"
              class="input-field w-full"
              :aria-invalid="username.length > 0 && !usernameValid"
              :aria-describedby="username.length > 0 && !usernameValid ? 'koreader-credentials-username-error' : undefined"
            />
            <p v-if="username.length > 0 && !usernameValid" id="koreader-credentials-username-error" class="mt-1.5 text-xs text-destructive">
              {{ t('settings.reader.koreader.changeCredentials.usernameInvalid') }}
            </p>
          </div>

          <div>
            <label for="koreader-credentials-password" class="mb-1.5 block text-sm font-medium text-foreground">
              {{ t('settings.reader.koreader.changeCredentials.newPassword') }}
            </label>
            <div class="relative">
              <input
                id="koreader-credentials-password"
                v-model="password"
                v-bind="SECRET_INPUT_ATTRS"
                type="text"
                minlength="6"
                maxlength="128"
                :placeholder="t('settings.reader.koreader.changeCredentials.passwordPlaceholder')"
                class="input-field w-full pr-10"
                :class="{ 'input-secret': !showPassword }"
                :aria-invalid="password.length > 0 && !passwordValid"
                :aria-describedby="
                  password.length > 0 && !passwordValid ? 'koreader-credentials-password-error' : 'koreader-credentials-password-hint'
                "
              />
              <button
                type="button"
                class="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :aria-label="
                  showPassword
                    ? t('settings.reader.koreader.changeCredentials.hidePassword')
                    : t('settings.reader.koreader.changeCredentials.showPassword')
                "
                @click="handleTogglePassword"
              >
                <EyeOff v-if="showPassword" :size="16" aria-hidden="true" />
                <Eye v-else :size="16" aria-hidden="true" />
              </button>
            </div>
            <p id="koreader-credentials-password-hint" class="mt-1.5 text-xs text-muted-foreground">
              {{ t('settings.reader.koreader.changeCredentials.passwordHint') }}
            </p>
            <p v-if="password.length > 0 && !passwordValid" id="koreader-credentials-password-error" class="mt-1.5 text-xs text-destructive">
              {{ t('settings.reader.koreader.changeCredentials.passwordInvalid') }}
            </p>
          </div>

          <p class="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {{ t('settings.reader.koreader.changeCredentials.deviceNotice') }}
          </p>
          <p v-if="props.error" role="alert" class="text-sm text-destructive">
            {{ props.error }}
          </p>

          <div class="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" :disabled="props.saving" @click="handleCancel">
              {{ t('common.cancel') }}
            </Button>
            <Button type="submit" :disabled="!canSave">
              <Loader2 v-if="props.saving" class="animate-spin" aria-hidden="true" />
              {{ props.saving ? t('settings.reader.koreader.changeCredentials.saving') : t('settings.reader.koreader.changeCredentials.save') }}
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
