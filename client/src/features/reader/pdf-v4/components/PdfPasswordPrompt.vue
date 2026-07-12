<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { KeyRound, LoaderCircle } from '@lucide/vue'
import type { DocumentState } from '@embedpdf/core'
import { useDocumentManagerCapability } from '@embedpdf/plugin-document-manager/vue'

const props = defineProps<{ documentState: DocumentState }>()
const emit = defineEmits<{ back: [] }>()

const { provides: documentManager } = useDocumentManagerCapability()
const password = ref('')
const submitting = ref(false)
const errorMessage = ref('')
const passwordInput = ref<HTMLInputElement | null>(null)

function handleBack() {
  emit('back')
}

function handleSubmit() {
  const value = password.value
  if (!value || submitting.value || !documentManager.value) return
  submitting.value = true
  errorMessage.value = ''
  documentManager.value.retryDocument(props.documentState.id, { password: value }).wait(
    () => {
      submitting.value = false
    },
    () => {
      submitting.value = false
      password.value = ''
      errorMessage.value = 'That password did not unlock the PDF.'
      void nextTick(() => passwordInput.value?.focus())
    },
  )
}
</script>

<template>
  <div class="flex h-full items-center justify-center bg-muted/30 p-6">
    <div class="w-full max-w-sm rounded-xl border border-border bg-card p-6 text-card-foreground shadow-xl">
      <div class="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
        <KeyRound :size="21" />
      </div>
      <h2 class="text-center font-serif text-lg font-semibold">Password required</h2>
      <p class="mt-1 text-center text-xs text-muted-foreground">Enter the document password to open this PDF.</p>

      <form class="mt-5" @submit.prevent="handleSubmit">
        <input
          ref="passwordInput"
          v-model="password"
          type="password"
          autocomplete="off"
          autofocus
          :disabled="submitting"
          placeholder="Document password"
          class="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
        />
        <p v-if="errorMessage" class="mt-2 text-xs text-destructive">{{ errorMessage }}</p>
        <div class="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            class="rounded-md border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
            @click="handleBack"
          >
            Go back
          </button>
          <button
            type="submit"
            :disabled="!password || submitting"
            class="flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            <LoaderCircle v-if="submitting" :size="14" class="animate-spin" />
            Unlock
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
