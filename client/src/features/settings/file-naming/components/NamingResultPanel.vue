<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ClipboardCopy, Eye, TriangleAlert } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { EXAMPLE_PATTERN_METADATA } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { copyToClipboard } from '@/lib/clipboard'
import PathTreePreview from './PathTreePreview.vue'
import { MISSING_METADATA_CASES, previewDownloadName, previewUploadPath } from '../lib/pattern-preview'
import type { NamingTarget } from '../lib/naming-rules'

const props = defineProps<{
  pattern: string
  target: NamingTarget
  ruleName: string
  sanitize: boolean
  sanitizeBusy?: boolean
}>()

const emit = defineEmits<{ 'update:sanitize': [value: boolean] }>()

const { t } = useI18n()

const CASE_LABELS = {
  noSeries: 'settings.reader.fileNaming.caseNoSeriesLabel',
  noYear: 'settings.reader.fileNaming.caseNoYearLabel',
  noAuthor: 'settings.reader.fileNaming.caseNoAuthorLabel',
} as const

function resolve(metadata: Record<string, string>): string {
  const options = { sanitizeForCrossPlatform: props.sanitize }
  return props.target === 'download' ? previewDownloadName(props.pattern, options, metadata) : previewUploadPath(props.pattern, options, metadata)
}

const resolved = computed(() => resolve(EXAMPLE_PATTERN_METADATA))

const fallbackCases = computed(() =>
  MISSING_METADATA_CASES.map((previewCase) => ({
    id: previewCase.id,
    label: t(CASE_LABELS[previewCase.id as keyof typeof CASE_LABELS]),
    path: resolve(previewCase.metadata),
  })),
)

async function handleCopy() {
  if (!resolved.value) return
  const copied = await copyToClipboard(resolved.value)
  if (copied) toast.success(t('settings.reader.fileNaming.resultCopied'))
  else toast.error(t('settings.reader.fileNaming.resultCopyFailed'))
}

function handleSanitize(value: boolean) {
  emit('update:sanitize', value)
}
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-border bg-card shadow-xs" :aria-label="t('settings.reader.fileNaming.resultPanel')">
    <header class="flex items-center justify-between gap-2 border-b border-border px-3.5 py-2.5">
      <h3 class="flex min-w-0 items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        <Eye :size="12" class="shrink-0" aria-hidden="true" />
        <span class="truncate">{{ t('settings.reader.fileNaming.resultFor', { rule: ruleName }) }}</span>
      </h3>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            :disabled="!resolved"
            :aria-label="t('settings.reader.fileNaming.copyResult')"
            @click="handleCopy"
          >
            <ClipboardCopy :size="14" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ t('settings.reader.fileNaming.copyResult') }}</TooltipContent>
      </Tooltip>
    </header>

    <div class="flex gap-3 border-b border-border px-3.5 py-3">
      <span aria-hidden="true" class="h-16 w-11 shrink-0 rounded bg-gradient-to-br from-primary to-primary/25 shadow-sm" />
      <div class="min-w-0">
        <p class="font-serif text-[15px] font-semibold leading-tight text-foreground">{{ EXAMPLE_PATTERN_METADATA.title }}</p>
        <p class="mt-0.5 text-xs text-muted-foreground">{{ EXAMPLE_PATTERN_METADATA.authors }} &middot; {{ EXAMPLE_PATTERN_METADATA.year }}</p>
        <p class="text-xs text-muted-foreground">{{ EXAMPLE_PATTERN_METADATA.series }} #{{ EXAMPLE_PATTERN_METADATA.seriesIndex }}</p>
        <p class="mt-1 text-[11px] text-muted-foreground">{{ t('settings.reader.fileNaming.sampleBookNote') }}</p>
      </div>
    </div>

    <div class="px-3.5 py-3">
      <PathTreePreview :path="resolved" />
    </div>

    <div class="border-t border-border px-3.5 py-3">
      <h4 class="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <TriangleAlert :size="11" class="shrink-0" aria-hidden="true" />
        {{ t('settings.reader.fileNaming.missingMetadata') }}
      </h4>
      <dl class="divide-y divide-dashed divide-border">
        <div v-for="item in fallbackCases" :key="item.id" class="py-1.5">
          <dt class="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
            <span aria-hidden="true" class="size-1.5 shrink-0 rounded-full bg-warning" />
            {{ item.label }}
          </dt>
          <dd class="mt-0.5 break-words font-mono text-[11px] text-foreground">
            {{ item.path || t('settings.reader.fileNaming.previewEmptyShort') }}
          </dd>
        </div>
      </dl>
    </div>

    <div class="flex items-center gap-3 border-t border-border bg-muted/30 px-3.5 py-3">
      <div class="min-w-0 flex-1">
        <p class="settings-label">{{ t('settings.reader.fileNaming.crossPlatform') }}</p>
        <p class="settings-hint">{{ t('settings.reader.fileNaming.crossPlatformShortHint') }}</p>
      </div>
      <ToggleSwitch
        :model-value="sanitize"
        :disabled="sanitizeBusy"
        :aria-label="t('settings.reader.fileNaming.crossPlatform')"
        @update:model-value="handleSanitize"
      />
    </div>
  </section>
</template>
