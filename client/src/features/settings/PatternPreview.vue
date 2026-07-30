<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ClipboardCopy } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { copyToClipboard } from '@/lib/clipboard'

const props = defineProps<{ value: string; label: string }>()

const { t } = useI18n()

async function handleCopy() {
  const copied = await copyToClipboard(props.value)
  if (copied) {
    toast.success(t('settings.reader.fileNaming.labelCopied', { label: props.label }))
  } else {
    toast.error(t('settings.reader.fileNaming.copyLabelFailed', { label: props.label.toLowerCase() }))
  }
}
</script>

<template>
  <div class="flex items-center gap-3 rounded-md border border-border/60 bg-muted/40 px-3 py-2">
    <span class="shrink-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {{ t('settings.reader.fileNaming.previewLabel') }}
    </span>
    <span class="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-foreground">{{ value }}</span>
    <Tooltip>
      <TooltipTrigger as-child>
        <button
          type="button"
          class="shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :aria-label="t('settings.reader.fileNaming.copyPreview', { label })"
          @click="handleCopy"
        >
          <ClipboardCopy :size="14" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{{ t('settings.reader.fileNaming.copyPreview', { label }) }}</TooltipContent>
    </Tooltip>
  </div>
</template>
