<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import MetadataReminderControls from './MetadataReminderControls.vue'
import { useMetadataReminders } from '../composables/useMetadataReminders'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [open: boolean]; closed: [] }>()
const { t } = useI18n()
const { saving } = useMetadataReminders()

function handleOpenChange(open: boolean) {
  if (!saving.value) emit('update:open', open)
}

function closeSheet() {
  handleOpenChange(false)
}

function restoreFocus(event: Event) {
  event.preventDefault()
  emit('closed')
}
</script>

<template>
  <Sheet :open="open" @update:open="handleOpenChange">
    <SheetContent side="right" hide-close class="w-full gap-0 sm:max-w-lg" @close-auto-focus="restoreFocus">
      <SheetHeader class="border-b border-border">
        <SheetTitle>{{ t('metadataReminders.title') }}</SheetTitle>
        <SheetDescription>{{ t('metadataReminders.sheetDescription') }}</SheetDescription>
      </SheetHeader>
      <div class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        <MetadataReminderControls />
      </div>
      <SheetFooter class="border-t border-border">
        <Button type="button" :disabled="saving" @click="closeSheet">{{ t('common.close') }}</Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
