<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, CircleAlert } from '@lucide/vue'
import type { LibraryLastScan } from '@bookorbit/types'
import { formatDateTime } from '@/i18n/formatters'
import { relativeTimestamp } from '@/lib/relative-time'

const props = defineProps<{ scan: LibraryLastScan }>()

const { t } = useI18n()

const timeLabel = computed(() => relativeTimestamp(props.scan.startedAt))
const exactTime = computed(() => formatDateTime(new Date(props.scan.startedAt)))
const trigger = computed(() => t(`settings.admin.libraries.scanTrigger.${props.scan.triggeredBy}`))

/** Added in green and missing in amber, the way the history table colours them; "no change" when nothing moved. */
const outcomeParts = computed(() => {
  const scan = props.scan
  const parts: { key: string; text: string; tone: string }[] = []
  if (scan.addedCount > 0)
    parts.push({ key: 'added', text: t('settings.admin.libraries.scanAdded', { count: scan.addedCount }), tone: 'text-[var(--pill-success)]' })
  if (scan.updatedCount > 0) parts.push({ key: 'updated', text: t('settings.admin.libraries.scanUpdated', { count: scan.updatedCount }), tone: '' })
  if (scan.missingCount > 0)
    parts.push({ key: 'missing', text: t('settings.admin.libraries.scanMissing', { count: scan.missingCount }), tone: 'text-[var(--pill-warning)]' })
  if (parts.length === 0) parts.push({ key: 'none', text: t('settings.admin.libraries.scanNoChange'), tone: '' })
  return parts
})
const outcomeTitle = computed(() =>
  t('settings.admin.libraries.scanOutcome', {
    trigger: trigger.value,
    outcome: outcomeParts.value.map((part) => part.text).join(t('settings.admin.libraries.outcomeSeparator')),
  }),
)
</script>

<template>
  <div>
    <template v-if="scan.status === 'failed'">
      <p class="flex items-center gap-1.5 text-sm font-medium text-destructive">
        <CircleAlert :size="13" class="shrink-0" aria-hidden="true" />
        <span class="truncate" :title="exactTime">{{ t('settings.admin.libraries.scanFailedAt', { time: timeLabel }) }}</span>
      </p>
      <p v-if="scan.errorMessage" class="mt-0.5 truncate font-mono text-xs text-destructive" :title="scan.errorMessage">{{ scan.errorMessage }}</p>
      <p v-else class="mt-0.5 truncate text-xs text-muted-foreground" :title="outcomeTitle">{{ outcomeTitle }}</p>
    </template>
    <template v-else>
      <p class="flex items-center gap-1.5 text-sm font-medium text-foreground">
        <Check :size="13" class="shrink-0 text-[var(--pill-success)]" aria-hidden="true" />
        <span class="truncate" :title="exactTime">{{ t('settings.admin.libraries.scannedAt', { time: timeLabel }) }}</span>
      </p>
      <i18n-t
        keypath="settings.admin.libraries.scanOutcome"
        tag="p"
        class="mt-0.5 truncate text-xs text-muted-foreground"
        scope="global"
        :title="outcomeTitle"
      >
        <template #trigger>{{ trigger }}</template>
        <template #outcome>
          <template v-for="(part, index) in outcomeParts" :key="part.key">
            <template v-if="index > 0">{{ t('settings.admin.libraries.outcomeSeparator') }}</template>
            <span :class="part.tone">{{ part.text }}</span>
          </template>
        </template>
      </i18n-t>
    </template>
  </div>
</template>
