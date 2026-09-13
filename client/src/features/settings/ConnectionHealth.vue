<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, TriangleAlert } from '@lucide/vue'
import { formatDateTime, formatRelativeFromNow } from '@/i18n/formatters'

const props = defineProps<{
  lastTestedAt: string | null
  lastTestOk: boolean | null
  enabled: boolean
}>()

const { t } = useI18n()

type Health = 'ok' | 'failed' | 'untested' | 'disabled'

const TONES: Record<Health, string> = {
  ok: 'border-success/40 bg-success/10 text-success',
  failed: 'border-destructive/40 bg-destructive/10 text-destructive',
  untested: 'border-border bg-muted text-muted-foreground',
  disabled: 'border-border bg-muted text-muted-foreground',
}

/** Disabled outranks a stale green: a connection nobody will call is not "connected". */
const health = computed<Health>(() => {
  if (!props.enabled) return 'disabled'
  if (props.lastTestedAt === null) return 'untested'
  return props.lastTestOk ? 'ok' : 'failed'
})

const label = computed(() => t(`settings.system.requests.health.${health.value}`))

/**
 * "failed 6 minutes ago" beats a timestamp buried in a sentence: recency is the whole point of
 * the fact, and the exact moment is one hover away.
 */
const relative = computed(() => (props.lastTestedAt === null ? null : formatRelativeFromNow(new Date(props.lastTestedAt))))
const exact = computed(() => (props.lastTestedAt === null ? undefined : formatDateTime(new Date(props.lastTestedAt))))
const testedLabel = computed(() =>
  health.value === 'failed'
    ? t('settings.system.requests.health.failedAt', { time: relative.value ?? '' })
    : t('settings.system.requests.health.testedAt', { time: relative.value ?? '' }),
)
</script>

<template>
  <span class="inline-flex items-center gap-1.5">
    <span class="inline-flex h-[22px] items-center gap-1.5 rounded-full border px-2 text-xs font-medium whitespace-nowrap" :class="TONES[health]">
      <Check v-if="health === 'ok'" :size="12" :stroke-width="2.5" aria-hidden="true" />
      <TriangleAlert v-else-if="health === 'failed'" :size="12" aria-hidden="true" />
      <span v-else class="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {{ label }}
    </span>
    <span v-if="relative" class="text-xs text-muted-foreground" :title="exact">{{ testedLabel }}</span>
  </span>
</template>
