import { computed, type ComputedRef } from 'vue'
import { useI18n } from 'vue-i18n'
import type { JumpBucket, JumpBucketKind, SortField, TemporalJumpBucketGranularity } from '@bookorbit/types'
import { formatDate, formatLanguageName, formatNumber } from '@/i18n/formatters'

const MAX_TEMPORAL_SLOTS = 64

export type JumpRailSlot = {
  key: string
  label: string
  displayLabel: string
  accessibleLabel: string
  bucket: JumpBucket | null
}

type JumpRailSlotOptions = {
  buckets: () => JumpBucket[]
  kind: () => JumpBucketKind
  field: () => SortField
  granularity: () => TemporalJumpBucketGranularity | null | undefined
  template: () => string[] | undefined
  maxSlots: () => number | undefined
}

const READ_STATUS_MESSAGE_KEYS: Record<string, string> = {
  unread: 'book.readStatus.unread',
  want_to_read: 'book.readStatus.wantToRead',
  reading: 'book.readStatus.reading',
  on_hold: 'book.readStatus.onHold',
  rereading: 'book.readStatus.rereading',
  read: 'book.readStatus.read',
  skimmed: 'book.readStatus.skimmed',
  abandoned: 'book.readStatus.abandoned',
}

function mergeLetterTemplate(template: string[], buckets: JumpBucket[]): string[] {
  const templateIndexes = new Map(template.map((key, index) => [key, index]))
  const keys: string[] = []
  let templateIndex = 0
  for (const bucket of buckets) {
    const index = templateIndexes.get(bucket.key)
    if (index === undefined || index < templateIndex) {
      if (!keys.includes(bucket.key)) keys.push(bucket.key)
      continue
    }
    while (templateIndex <= index) keys.push(template[templateIndex++]!)
  }
  while (templateIndex < template.length) keys.push(template[templateIndex++]!)
  return keys
}

function shiftDateKey(key: string, unit: 'day' | 'month', amount: number): string | null {
  const date = new Date(`${unit === 'month' ? `${key}-01` : key}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return null
  if (unit === 'month') date.setUTCMonth(date.getUTCMonth() + amount)
  else date.setUTCDate(date.getUTCDate() + amount)
  const shifted = date.toISOString().slice(0, 10)
  return unit === 'month' ? shifted.slice(0, 7) : shifted
}

function temporalDistance(start: string, end: string, granularity: TemporalJumpBucketGranularity): number | null {
  if (granularity.unit === 'year') {
    const startYear = Number(start)
    const endYear = Number(end)
    if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) return null
    return Math.abs((endYear - startYear) / granularity.step)
  }

  const startDate = new Date(`${granularity.unit === 'month' ? `${start}-01` : start}T00:00:00Z`)
  const endDate = new Date(`${granularity.unit === 'month' ? `${end}-01` : end}T00:00:00Z`)
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null
  if (granularity.unit === 'month') {
    return Math.abs((endDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 + endDate.getUTCMonth() - startDate.getUTCMonth())
  }
  return Math.abs((endDate.getTime() - startDate.getTime()) / 86_400_000)
}

function shiftTemporalKey(key: string, granularity: TemporalJumpBucketGranularity, amount: number): string | null {
  if (granularity.unit === 'year') {
    const year = Number(key)
    return Number.isFinite(year) ? String(year + amount * granularity.step) : null
  }
  return shiftDateKey(key, granularity.unit, amount)
}

function temporalTimelineKeys(buckets: JumpBucket[], granularity: TemporalJumpBucketGranularity | null | undefined, maxSlots: number): string[] {
  const known = buckets.filter((bucket) => !bucket.isUnknown)
  if (!granularity || known.length < 2) return known.map((bucket) => bucket.key)

  const capacity = Math.max(known.length, Math.min(MAX_TEMPORAL_SLOTS, Math.max(2, maxSlots)))
  const gaps = known.slice(0, -1).map((bucket, index) => {
    const next = known[index + 1]!
    const distance = temporalDistance(bucket.key, next.key, granularity)
    return { start: bucket.key, end: next.key, distance: distance ?? 1, markers: 0 }
  })
  let remaining = capacity - known.length
  while (remaining > 0) {
    let selected: (typeof gaps)[number] | null = null
    let selectedScore = 0
    for (const gap of gaps) {
      const missing = Math.max(0, Math.floor(gap.distance) - 1)
      if (gap.markers >= missing) continue
      const score = missing / (gap.markers + 1)
      if (score > selectedScore) {
        selected = gap
        selectedScore = score
      }
    }
    if (!selected) break
    selected.markers += 1
    remaining -= 1
  }

  const keys: string[] = []
  for (let index = 0; index < known.length; index++) {
    keys.push(known[index]!.key)
    const gap = gaps[index]
    if (!gap || gap.markers === 0) continue
    const startValue = granularity.unit === 'year' ? Number(gap.start) : gap.start
    const endValue = granularity.unit === 'year' ? Number(gap.end) : gap.end
    const direction = startValue <= endValue ? 1 : -1
    for (let marker = 1; marker <= gap.markers; marker++) {
      const offset = Math.round((gap.distance * marker) / (gap.markers + 1)) * direction
      const key = shiftTemporalKey(gap.start, granularity, offset)
      if (key && key !== gap.start && key !== gap.end) keys.push(key)
    }
  }
  return keys
}

export function useJumpRailSlots(options: JumpRailSlotOptions): ComputedRef<JumpRailSlot[]> {
  const { t, locale } = useI18n()

  function temporalLabels(bucket: JumpBucket): Pick<JumpRailSlot, 'label' | 'displayLabel' | 'accessibleLabel'> {
    if (bucket.isUnknown) {
      const label = t('book.jumpRail.unknownDate')
      return { label, displayLabel: '?', accessibleLabel: label }
    }

    const granularity = options.granularity()
    if (!granularity) return { label: bucket.label, displayLabel: bucket.label, accessibleLabel: bucket.label }
    if (granularity.unit === 'year') {
      const start = Number(bucket.key)
      if (!Number.isFinite(start)) return { label: bucket.label, displayLabel: bucket.label, accessibleLabel: bucket.label }
      const startLabel = formatNumber(start, { useGrouping: false })
      if (granularity.step === 1) return { label: startLabel, displayLabel: startLabel, accessibleLabel: startLabel }
      const endLabel = formatNumber(start + granularity.step - 1, { useGrouping: false })
      const range = `${startLabel}-${endLabel}`
      return { label: range, displayLabel: startLabel, accessibleLabel: range }
    }

    const dateKey = granularity.unit === 'month' ? `${bucket.key}-01` : bucket.key
    const date = new Date(`${dateKey}T00:00:00Z`)
    if (Number.isNaN(date.getTime())) return { label: bucket.label, displayLabel: bucket.label, accessibleLabel: bucket.label }
    if (granularity.unit === 'month') {
      const fullLabel = formatDate(date, { month: 'long', year: 'numeric', timeZone: 'UTC' })
      return {
        label: fullLabel,
        displayLabel: bucket.key.endsWith('-01') ? formatDate(date, { year: 'numeric', timeZone: 'UTC' }) : '',
        accessibleLabel: fullLabel,
      }
    }
    const fullLabel = formatDate(date, { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    return {
      label: fullLabel,
      displayLabel: bucket.key.endsWith('-01-01')
        ? formatDate(date, { year: 'numeric', timeZone: 'UTC' })
        : bucket.key.endsWith('-01')
          ? formatDate(date, { month: 'short', timeZone: 'UTC' })
          : '',
      accessibleLabel: fullLabel,
    }
  }

  function categoryLabels(bucket: JumpBucket): Pick<JumpRailSlot, 'label' | 'displayLabel' | 'accessibleLabel'> {
    if (bucket.isUnknown) {
      const label = t('book.jumpRail.unknownValue')
      return { label, displayLabel: '?', accessibleLabel: label }
    }

    let label = bucket.label
    switch (options.field()) {
      case 'format':
        label = bucket.key.toUpperCase()
        break
      case 'language':
        label = formatLanguageName(bucket.key)
        break
      case 'readStatus': {
        const messageKey = READ_STATUS_MESSAGE_KEYS[bucket.key]
        label = messageKey ? t(messageKey) : bucket.label
        break
      }
    }
    return { label, displayLabel: label, accessibleLabel: label }
  }

  return computed(() => {
    void locale.value
    const buckets = options.buckets()
    const kind = options.kind()
    const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]))

    if (kind === 'letter') {
      const template = options.template() ?? []
      const keys = mergeLetterTemplate(template, buckets)
      return keys.map((key) => ({ key, label: key, displayLabel: key, accessibleLabel: key, bucket: byKey.get(key) ?? null }))
    }

    if (kind === 'category') {
      return buckets.map((bucket) => ({ key: bucket.key, ...categoryLabels(bucket), bucket }))
    }

    const unknown = buckets.find((bucket) => bucket.isUnknown)
    const maxKnownSlots = Math.max(2, (options.maxSlots() ?? MAX_TEMPORAL_SLOTS) - (unknown ? 1 : 0))
    const timelineKeys = temporalTimelineKeys(buckets, options.granularity(), maxKnownSlots)
    if (unknown) timelineKeys.push(unknown.key)
    const temporalSlots: JumpRailSlot[] = timelineKeys.map((key) => {
      const bucket = byKey.get(key) ?? null
      const labels = temporalLabels(bucket ?? { key, label: key, index: -1 })
      return { key, ...labels, displayLabel: bucket ? labels.displayLabel : '', bucket }
    })
    const displayedYears = new Set(temporalSlots.filter((slot) => slot.displayLabel).map((slot) => slot.key.slice(0, 4)))
    for (const index of [0, temporalSlots.length - 1]) {
      const slot = temporalSlots[index]
      if (!slot || slot.displayLabel || slot.bucket?.isUnknown) continue
      const yearKey = slot.key.slice(0, 4)
      if (displayedYears.has(yearKey)) continue
      const year = Number(slot.key.slice(0, 4))
      slot.displayLabel = Number.isFinite(year) ? formatNumber(year, { useGrouping: false }) : slot.label
      displayedYears.add(yearKey)
    }
    return temporalSlots
  })
}
