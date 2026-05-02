<script setup lang="ts">
const props = defineProps<{
  value: string | null
  variant?: 'default' | 'relative'
}>()

function parseDate(isoDate: string | null): Date | null {
  if (!isoDate?.trim()) return null
  const date = new Date(isoDate)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDate(isoDate: string | null): string {
  const date = parseDate(isoDate)
  if (!date) return '-'
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatRelativeTime(date: Date): string {
  const diffMs = date.getTime() - Date.now()
  const absMs = Math.abs(diffMs)
  if (absMs < 5_000) return 'just now'

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const units = [
    ['year', 1000 * 60 * 60 * 24 * 365],
    ['month', 1000 * 60 * 60 * 24 * 30],
    ['day', 1000 * 60 * 60 * 24],
    ['hour', 1000 * 60 * 60],
    ['minute', 1000 * 60],
    ['second', 1000],
  ] as const

  for (const [unit, ms] of units) {
    if (absMs >= ms || unit === 'second') {
      return formatter.format(Math.round(diffMs / ms), unit)
    }
  }

  return 'just now'
}

function getDisplayText(isoDate: string | null, variant: 'default' | 'relative' | undefined): string {
  const date = parseDate(isoDate)
  if (!date) return '-'
  return variant === 'relative' ? formatRelativeTime(date) : formatDate(isoDate)
}

function getTooltip(isoDate: string | null): string {
  const date = parseDate(isoDate)
  if (!date || !isoDate?.trim()) return ''
  return `${isoDate} (${formatRelativeTime(date)})`
}
</script>

<template>
  <span class="text-xs text-muted-foreground" :title="getTooltip(props.value)">{{ getDisplayText(props.value, props.variant) }}</span>
</template>
