<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

const props = defineProps<{
  title: string
  note: string | null
}>()
const emit = defineEmits<{
  save: [title: string, note: string | null]
  cancel: []
}>()

const { t } = useI18n()
const titleId = useId()
const noteId = useId()

const draftTitle = ref(props.title)
const draftNote = ref(props.note ?? '')
const canSave = computed(() => draftTitle.value.trim().length > 0)

function handleOpenChange(open: boolean) {
  if (!open) emit('cancel')
}

function handleCancel() {
  emit('cancel')
}

function handleSave() {
  if (!canSave.value) return
  const note = draftNote.value.trim()
  emit('save', draftTitle.value.trim(), note === '' ? null : note)
}
</script>

<template>
  <DialogRoot :open="true" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[70] bg-scrim" />
      <DialogContent
        aria-modal="true"
        :aria-describedby="undefined"
        class="fixed left-1/2 top-1/2 z-[70] flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-lg bg-card p-4 text-card-foreground shadow-2xl focus-visible:outline-none"
      >
        <DialogTitle class="text-sm font-medium">{{ t('reader.bookmarkEdit.title') }}</DialogTitle>
        <form class="flex flex-col gap-3" @submit.prevent="handleSave">
          <div class="flex flex-col gap-1">
            <label :for="titleId" class="text-xs text-muted-foreground">{{ t('reader.bookmarkEdit.titleLabel') }}</label>
            <Input :id="titleId" v-model="draftTitle" maxlength="500" />
          </div>
          <div class="flex flex-col gap-1">
            <label :for="noteId" class="text-xs text-muted-foreground">{{ t('reader.bookmarkEdit.noteLabel') }}</label>
            <Textarea
              :id="noteId"
              v-model="draftNote"
              :placeholder="t('reader.bookmarkEdit.notePlaceholder')"
              class="resize-none"
              rows="3"
              maxlength="4000"
            />
          </div>
          <div class="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" @click="handleCancel">{{ t('common.cancel') }}</Button>
            <Button type="submit" size="sm" :disabled="!canSave">{{ t('common.save') }}</Button>
          </div>
        </form>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
