<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { SearchX } from '@lucide/vue'
import { formatDateTime, formatNumber, formatRelativeFromNow } from '@/i18n/formatters'

/**
 * How this source has been behaving in real searches, which is a different question from what the
 * Test button answers: a caps call can succeed against a tracker that has refused every search
 * since Tuesday, and the picker's live failure list stops existing the moment the drawer closes.
 *
 * Shown only while a source is failing. A green badge beside the connection badge would be two
 * ticks saying almost the same thing, and the one worth interrupting an operator for is the run
 * of failures nobody has watched happen.
 */
const props = defineProps<{
  lastSearchAt: string | null
  lastSearchOk: boolean | null
  searchFailureStreak: number
  enabled: boolean
}>()

const { t } = useI18n()

/** A disabled source is not failing; nothing is searching it. */
const failing = computed(() => props.enabled && props.lastSearchOk === false && props.searchFailureStreak > 0)

const relative = computed(() => (props.lastSearchAt === null ? null : formatRelativeFromNow(new Date(props.lastSearchAt))))
const exact = computed(() => (props.lastSearchAt === null ? undefined : formatDateTime(new Date(props.lastSearchAt))))

/**
 * One failure is noise a retry usually clears; a run of them is the fact worth naming, and the
 * count is what separates the two at a glance.
 */
const label = computed(() =>
  props.searchFailureStreak > 1
    ? t('settings.system.requests.searchHealth.failingStreak', { count: formatNumber(props.searchFailureStreak) })
    : t('settings.system.requests.searchHealth.failingOnce'),
)
</script>

<template>
  <span v-if="failing" class="inline-flex items-center gap-1.5">
    <span
      class="inline-flex h-[22px] items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2 text-xs font-medium whitespace-nowrap text-foreground"
    >
      <SearchX :size="12" class="text-warning" aria-hidden="true" />
      {{ label }}
    </span>
    <span v-if="relative" class="text-xs text-muted-foreground" :title="exact">
      {{ t('settings.system.requests.searchHealth.lastSearchAt', { time: relative }) }}
    </span>
  </span>
</template>
