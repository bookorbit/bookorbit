<script setup lang="ts">
import { computed } from 'vue'
import { Loader2, RefreshCw } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { CoverSweep } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import { formatDateTime, formatNumber } from '@/i18n/formatters'

const props = defineProps<{ sweep: CoverSweep | null; sweeping: boolean }>()
const emit = defineEmits<{ run: [] }>()

const { t } = useI18n()

const progressStyle = computed(() => ({ width: `${props.sweep?.progressPercent ?? 0}%` }))
const completedLabel = computed(() => {
  const completedAt = props.sweep?.completedAt
  if (!completedAt) return null
  return t('tools.missingResources.sweep.lastRun', { at: formatDateTime(new Date(completedAt)) })
})

function handleRun(): void {
  emit('run')
}
</script>

<template>
  <section class="shrink-0 rounded-lg border border-border/70 bg-card/50 p-4">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div class="min-w-0 space-y-1">
        <h2 class="text-sm font-semibold text-foreground">{{ t('tools.missingResources.sweep.title') }}</h2>
        <p class="max-w-2xl text-sm text-muted-foreground">{{ t('tools.missingResources.sweep.description') }}</p>
      </div>
      <Button variant="outline" size="sm" class="shrink-0" :disabled="sweeping" @click="handleRun">
        <Loader2 v-if="sweeping" class="animate-spin" aria-hidden="true" />
        <RefreshCw v-else aria-hidden="true" />
        {{ sweeping ? t('tools.missingResources.sweep.running') : t('tools.missingResources.sweep.run') }}
      </Button>
    </div>

    <div v-if="sweeping" class="mt-3 space-y-1.5" role="status" aria-live="polite">
      <div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div class="h-full rounded-full bg-primary transition-[width] duration-300" :style="progressStyle" />
      </div>
      <p class="text-xs text-muted-foreground">
        {{
          t('tools.missingResources.sweep.progress', {
            processed: formatNumber(sweep?.processedBooks ?? 0),
            total: formatNumber(sweep?.totalBooks ?? 0),
          })
        }}
      </p>
    </div>

    <p v-else-if="completedLabel" class="mt-3 text-xs text-muted-foreground">{{ completedLabel }}</p>

    <p v-if="sweep?.truncated" class="mt-2 text-xs text-muted-foreground">{{ t('tools.missingResources.sweep.truncated') }}</p>
  </section>
</template>
