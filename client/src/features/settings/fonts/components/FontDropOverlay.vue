<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Upload } from '@lucide/vue'

/** Covers the page while files are dragged over it. Browsers give the count, not the names, until the drop. */
defineProps<{ count: number; titleKey: string }>()

const { t } = useI18n()
</script>

<template>
  <div class="pointer-events-none fixed inset-0 z-40 bg-scrim p-3 backdrop-blur-[3px]" aria-hidden="true" data-testid="font-drop-overlay">
    <div class="grid size-full place-items-center rounded-2xl border-2 border-dashed border-primary/70 bg-primary/6 text-center">
      <div class="rounded-xl border border-border bg-card px-8 py-6 shadow-lg">
        <div class="mx-auto mb-3.5 grid size-14 place-items-center rounded-full bg-primary/15 text-primary">
          <Upload :size="26" />
        </div>
        <p class="text-lg font-semibold text-foreground">{{ t(titleKey, { count }) }}</p>
        <p class="mt-1 text-[13px] text-muted-foreground">{{ t('settings.reader.fonts.fileTypesHint') }}</p>
      </div>
    </div>
  </div>
</template>
