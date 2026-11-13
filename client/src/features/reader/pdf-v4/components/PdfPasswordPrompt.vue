<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { KeyRound, LoaderCircle } from '@lucide/vue'
import { useDocuments, type LockedDocumentInfo } from '@embedpdf/vue/runtime'
import { SECRET_INPUT_ATTRS } from '@/lib/secret-input'

const props = defineProps<{ document: LockedDocumentInfo }>()
const emit = defineEmits<{ back: [] }>()

const { t } = useI18n()
const documents = useDocuments()
const password = ref('')
const submitting = ref(false)
const errorMessage = ref('')
const passwordInput = ref<HTMLInputElement | null>(null)

function handleBack() {
  emit('back')
}

async function handleSubmit() {
  const value = password.value
  if (!value || submitting.value) return
  submitting.value = true
  errorMessage.value = ''
  try {
    await documents.unlock(props.document.id, { password: value })
  } catch {
    password.value = ''
    errorMessage.value = t('reader.pdf.password.incorrect')
    void nextTick(() => passwordInput.value?.focus())
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="flex h-full items-center justify-center bg-muted/30 p-6">
    <div class="w-full max-w-sm rounded-xl border border-border bg-card p-6 text-card-foreground shadow-xl">
      <div class="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
        <KeyRound :size="21" />
      </div>
      <h2 class="text-center font-serif text-lg font-semibold">{{ t('reader.pdf.password.title') }}</h2>
      <p class="mt-1 text-center text-xs text-muted-foreground">{{ t('reader.pdf.password.description') }}</p>

      <form class="mt-5" @submit.prevent="handleSubmit">
        <input
          ref="passwordInput"
          v-model="password"
          v-bind="SECRET_INPUT_ATTRS"
          type="text"
          autofocus
          :disabled="submitting"
          :placeholder="t('reader.pdf.password.placeholder')"
          :aria-label="t('reader.pdf.password.placeholder')"
          :aria-invalid="errorMessage ? 'true' : undefined"
          aria-describedby="pdf-password-error"
          class="input-secret h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
        />
        <p v-if="errorMessage" id="pdf-password-error" class="mt-2 text-xs text-destructive" role="alert">{{ errorMessage }}</p>
        <div class="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            class="rounded-md border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
            @click="handleBack"
          >
            {{ t('reader.header.goBack') }}
          </button>
          <button
            type="submit"
            :disabled="!password || submitting"
            class="flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            <LoaderCircle v-if="submitting" :size="14" class="animate-spin" />
            {{ t('reader.pdf.password.unlock') }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
