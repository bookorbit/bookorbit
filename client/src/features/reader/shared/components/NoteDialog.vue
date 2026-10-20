<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

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

function handleOpenChange(open: boolean) {
  if (!open && !props.saving) emit('cancel')
}

function handleDismissWhileSaving(event: Event) {
  if (props.saving) event.preventDefault()
}

function handleInput(value: string) {
  emit('update:modelValue', value)
}

function handleCancel() {
  if (!props.saving) emit('cancel')
}

function handleSave() {
  if (!props.saving) emit('save', props.modelValue)
}
</script>

<template>
  <DialogRoot :open="true" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[70] bg-scrim" data-testid="note-dialog-overlay" />
      <DialogContent
        aria-modal="true"
        class="fixed left-1/2 top-1/2 z-[70] flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-lg bg-card p-4 text-card-foreground shadow-2xl focus-visible:outline-none"
        @escape-key-down="handleDismissWhileSaving"
        @pointer-down-outside="handleDismissWhileSaving"
        @interact-outside="handleDismissWhileSaving"
      >
        <DialogTitle class="text-sm font-medium">{{ t('reader.note.title') }}</DialogTitle>
        <DialogDescription class="line-clamp-2 text-xs italic text-muted-foreground">"{{ selectedText }}"</DialogDescription>
        <Textarea
          :modelValue="modelValue"
          :disabled="props.saving"
          :aria-label="t('reader.note.title')"
          :placeholder="t('reader.note.placeholder')"
          class="resize-none"
          rows="4"
          @update:modelValue="handleInput"
        />
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="sm" :disabled="props.saving" @click="handleCancel">
            {{ t('common.cancel') }}
          </Button>
          <Button size="sm" :disabled="props.saving" @click="handleSave">
            {{ t('common.save') }}
          </Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
