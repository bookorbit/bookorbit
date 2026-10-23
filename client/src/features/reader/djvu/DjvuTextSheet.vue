<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDjvuPageText } from './composables/useDjvuPageText'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'

const props = defineProps<{ open: boolean; fileId: number; pageIndex: number }>()
const emit = defineEmits<{ 'update:open': [open: boolean] }>()
const { t } = useI18n()
const { text, loading, failed, loadText } = useDjvuPageText(props)

// Announces state changes only; the page text itself is left for the reader to navigate.
const statusMessage = computed(() => {
  if (loading.value) return t('common.loading')
  if (failed.value) return t('reader.djvu.textFailed')
  if (!text.value) return t('reader.djvu.noText')
  return ''
})

function onOpenChange(open: boolean) {
  emit('update:open', open)
}
</script>

<template>
  <Sheet :open="open" @update:open="onOpenChange">
    <SheetContent side="bottom" hide-close class="max-h-[85dvh] flex flex-col bg-card text-foreground">
      <SheetHeader>
        <SheetTitle>{{ t('reader.djvu.pageText') }}</SheetTitle>
        <SheetDescription>{{ t('reader.djvu.textDescription') }}</SheetDescription>
      </SheetHeader>
      <SheetClose as-child>
        <button type="button" class="self-end rounded-md border border-border px-3 py-2 focus-visible:outline-2 focus-visible:outline-primary">
          {{ t('common.close') }}
        </button>
      </SheetClose>
      <p class="sr-only" role="status" aria-live="polite">{{ statusMessage }}</p>
      <div class="min-h-0 overflow-auto select-text p-4">
        <p v-if="loading" class="text-muted-foreground">{{ t('common.loading') }}</p>
        <div v-else-if="failed" class="space-y-3">
          <p>{{ t('reader.djvu.textFailed') }}</p>
          <button
            type="button"
            class="rounded-md border border-border px-3 py-2 focus-visible:outline-2 focus-visible:outline-primary"
            @click="loadText"
          >
            {{ t('common.retry') }}
          </button>
        </div>
        <p v-else-if="!text" class="text-muted-foreground">{{ t('reader.djvu.noText') }}</p>
        <p v-else class="whitespace-pre-wrap break-words" dir="auto">{{ text }}</p>
      </div>
    </SheetContent>
  </Sheet>
</template>
