<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  selectedText: string
  modelValue: string
  saving?: boolean
}>()
const emit = defineEmits<{
  save: [note: string]
  cancel: []
  'update:modelValue': [value: string]
}>()

function handleBackdropClick() {
  if (!props.saving) emit('cancel')
}

function handleInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
}

function handleCancel() {
  if (!props.saving) emit('cancel')
}

function handleSave() {
  if (!props.saving) emit('save', props.modelValue)
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[70] flex items-center justify-center bg-foreground/35 p-4" @click.self="handleBackdropClick">
      <div class="bg-card text-card-foreground rounded-lg shadow-2xl p-4 w-full max-w-sm flex flex-col gap-3">
        <p class="text-sm font-medium">{{ t('reader.note.title') }}</p>
        <p class="text-xs text-muted-foreground line-clamp-2 italic">"{{ selectedText }}"</p>
        <textarea
          :value="modelValue"
          :disabled="props.saving"
          @input="handleInput"
          class="w-full rounded-lg border border-border bg-background text-foreground text-sm p-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
          rows="4"
          :placeholder="t('reader.note.placeholder')"
          autofocus
        />
        <div class="flex gap-2 justify-end">
          <button
            class="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors"
            :disabled="props.saving"
            @click="handleCancel"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            class="px-3 py-1.5 rounded-lg text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            :disabled="props.saving"
            @click="handleSave"
          >
            {{ t('common.save') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
