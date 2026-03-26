<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import VChart from 'vue-echarts'
import { CalendarRange } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { UserReadingSessionTimeline, UserReadingSessionTimelineItem } from '@projectx/types'

import { getFormatColor } from '@/features/book/lib/format-colors'
import { fetchUserReadingSessionTimeline, updateUserReadingSessionTimelineSession } from '../../api/statistics.api'
import { useStatisticsConfig } from '../../composables/useStatisticsConfig'
import ChartCard from '../ChartCard.vue'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
const MAX_TRACKS = 3
const MINUTES_PER_DAY = 24 * 60
const SNAP_MINUTES = 5

interface SessionSegment {
  sessionId: number
  bookId: number
  bookTitle: string | null
  bookFormat: string | null
  dayIndex: number
  startMinute: number
  endMinute: number
  durationMinutes: number
  track: number
  totalTracks: number
}

interface DragState {
  sessionId: number
  durationMs: number
  offsetMinutes: number
}

interface DragPreview {
  sessionId: number
  dayIndex: number
  startMinute: number
  endMinute: number
  durationMinutes: number
  startedAt: string
  endedAt: string
  hasConflict: boolean
}

interface PointerOffset {
  x: number
  y: number
}

const { filters } = useStatisticsConfig()

const now = new Date()
const selectedYear = ref(getUtcIsoWeekYear(now))
const selectedWeek = ref(getUtcIsoWeek(now))

const loading = ref(true)
const error = ref(false)
const persistLoading = ref(false)
const dragEnabled = ref(false)
const dragState = ref<DragState | null>(null)
const dragPreview = ref<DragPreview | null>(null)
const chartRef = ref<InstanceType<typeof VChart> | null>(null)
const option = shallowRef({})

const timeline = ref<UserReadingSessionTimeline>({
  year: selectedYear.value,
  week: selectedWeek.value,
  weekStart: formatYmd(getUtcIsoWeekStart(selectedYear.value, selectedWeek.value)),
  weekEnd: formatYmd(addUtcDays(getUtcIsoWeekStart(selectedYear.value, selectedWeek.value), 6)),
  items: [],
})

const isEmpty = computed(() => timeline.value.items.length === 0)

const weekStartDate = computed(() => parseYmdUtc(timeline.value.weekStart) ?? getUtcIsoWeekStart(selectedYear.value, selectedWeek.value))
const weekEndExclusive = computed(() => addUtcDays(weekStartDate.value, 7))

const weekRangeLabel = computed(() => `${formatDateLabel(timeline.value.weekStart)} - ${formatDateLabel(timeline.value.weekEnd)}`)

const weekOptions = computed(() => {
  const count = getUtcIsoWeeksInYear(selectedYear.value)
  return Array.from({ length: count }, (_, i) => i + 1)
})

const yearOptions = computed(() => {
  const currentIsoYear = getUtcIsoWeekYear(new Date())
  const years = Array.from({ length: 11 }, (_, i) => currentIsoYear - i)
  if (!years.includes(selectedYear.value)) {
    years.push(selectedYear.value)
    years.sort((a, b) => b - a)
  }
  return years
})

const segments = computed<SessionSegment[]>(() => buildSegments(timeline.value.items, weekStartDate.value, weekEndExclusive.value))

const sessionsById = computed(() => {
  const map = new Map<number, UserReadingSessionTimelineItem>()
  for (const item of timeline.value.items) {
    map.set(item.sessionId, item)
  }
  return map
})

watch(selectedYear, (year) => {
  const maxWeek = getUtcIsoWeeksInYear(year)
  if (selectedWeek.value > maxWeek) selectedWeek.value = maxWeek
})

let requestId = 0
watch(
  [() => filters.value.libraryIds.join(','), selectedYear, selectedWeek],
  () => {
    void loadTimeline()
  },
  { immediate: true },
)

watch(dragEnabled, (enabled) => {
  if (!enabled) clearDragState()
})

watch(
  [segments, dragPreview, dragEnabled],
  () => {
    option.value = makeOption(segments.value, dragPreview.value)
  },
  { immediate: true },
)

async function loadTimeline() {
  const id = ++requestId
  loading.value = true
  error.value = false
  clearDragState()

  try {
    const next = await fetchUserReadingSessionTimeline(filters.value, selectedYear.value, selectedWeek.value)
    if (id !== requestId) return
    timeline.value = next
    selectedYear.value = next.year
    selectedWeek.value = next.week
  } catch {
    if (id !== requestId) return
    error.value = true
  } finally {
    if (id === requestId) loading.value = false
  }
}

function makeOption(data: SessionSegment[], preview: DragPreview | null) {
  const seriesData = data.map((segment) => ({
    value: [segment.dayIndex, segment.startMinute, segment.endMinute, segment.track, segment.totalTracks, segment.durationMinutes],
    sessionId: segment.sessionId,
    bookId: segment.bookId,
    bookTitle: segment.bookTitle,
    bookFormat: segment.bookFormat,
    durationMinutes: segment.durationMinutes,
    itemStyle: {
      color: getFormatColor(segment.bookFormat),
      opacity: 0.9,
    },
  }))

  const previewData = preview
    ? [
        {
          value: [preview.dayIndex, preview.startMinute, preview.endMinute, 0, 1, preview.durationMinutes],
          sessionId: preview.sessionId,
          itemStyle: {
            color: preview.hasConflict ? 'rgba(244, 63, 94, 0.25)' : 'rgba(16, 185, 129, 0.25)',
            borderColor: preview.hasConflict ? 'rgba(244, 63, 94, 0.9)' : 'rgba(16, 185, 129, 0.95)',
            borderWidth: 2,
            borderType: 'dashed',
          },
        },
      ]
    : []

  return {
    grid: { top: 16, right: 12, bottom: 26, left: 52, containLabel: false },
    xAxis: {
      type: 'value',
      min: 0,
      max: MINUTES_PER_DAY,
      interval: 60,
      splitLine: { lineStyle: { type: 'dashed', opacity: 0.4 } },
      axisLabel: {
        fontSize: 11,
        formatter: (value: number) => formatHourLabel(Number(value)),
      },
    },
    yAxis: {
      type: 'category',
      data: DAY_LABELS,
      axisTick: { show: false },
      splitLine: { show: true, lineStyle: { opacity: 0.25 } },
      axisLabel: { fontSize: 11 },
    },
    tooltip: {
      trigger: 'item',
      formatter: (params: {
        data: { bookId?: number; bookTitle?: string | null; bookFormat?: string | null; durationMinutes?: number; value: number[] }
      }) => {
        const d = params.data
        if (!d || !d.value) return ''
        const start = formatTimeLabel(d.value[1] ?? 0)
        const end = formatTimeLabel(d.value[2] ?? 0)
        const duration = formatDuration(Math.max(0, d.durationMinutes ?? 0))
        const title = escapeHtml(d.bookTitle ?? 'Reading session')
        const format = escapeHtml(d.bookFormat ?? 'Unknown')
        const cover = d.bookId
          ? `<img src="/api/v1/books/${d.bookId}/thumbnail" alt="Cover" style="width:32px;height:48px;object-fit:cover;border-radius:4px;" />`
          : ''

        return [
          '<div style="display:flex;gap:8px;align-items:flex-start;max-width:320px;">',
          cover,
          '<div>',
          `<div style="font-weight:600;margin-bottom:2px;">${title}</div>`,
          `<div style="opacity:0.85;">${start} - ${end}</div>`,
          `<div style="opacity:0.85;">${duration}</div>`,
          `<div style="opacity:0.72;">${format}</div>`,
          '</div>',
          '</div>',
        ].join('')
      },
    },
    series: [
      {
        id: 'sessionTimeline',
        type: 'custom',
        renderItem: renderTimelineItem,
        encode: {
          x: [1, 2],
          y: 0,
          tooltip: [1, 2],
        },
        data: seriesData,
        silent: false,
      },
      {
        id: 'sessionTimelineDragPreview',
        type: 'custom',
        renderItem: renderTimelineItem,
        encode: {
          x: [1, 2],
          y: 0,
        },
        data: previewData,
        silent: true,
      },
    ],
  }
}

function renderTimelineItem(
  params: { coordSys: { x: number; width: number } },
  api: {
    value: (dim: number) => number
    coord: (data: number[]) => [number, number]
    size: (data: number[]) => [number, number]
    style: (extra?: Record<string, unknown>) => Record<string, unknown>
  },
) {
  const dayIndex = Number(api.value(0))
  const start = Number(api.value(1))
  const end = Number(api.value(2))
  const track = Number(api.value(3))
  const totalTracks = Math.max(1, Number(api.value(4)))
  const durationMinutes = Number(api.value(5))

  const startCoord = api.coord([start, dayIndex])
  const endCoord = api.coord([end, dayIndex])
  const rowHeight = Math.abs(api.size([0, 1])[1])
  const trackGap = 2
  const trackHeight = totalTracks > 1 ? Math.max(4, (rowHeight - (totalTracks - 1) * trackGap) / totalTracks) : Math.max(10, rowHeight * 0.72)
  const baseline = startCoord[1] - rowHeight / 2

  const x = Math.min(startCoord[0], endCoord[0])
  const width = Math.max(2, Math.abs(endCoord[0] - startCoord[0]))
  const y = totalTracks > 1 ? baseline + track * (trackHeight + trackGap) : startCoord[1] - trackHeight / 2

  const left = params.coordSys.x
  const right = params.coordSys.x + params.coordSys.width
  const clippedX = Math.max(left, x)
  const clippedW = Math.min(right, x + width) - clippedX
  if (clippedW <= 0) return null

  const shortLabel = durationMinutes >= 60 && clippedW > 56 ? formatTimeLabel(start) : ''

  return {
    type: 'group',
    children: [
      {
        type: 'rect',
        shape: {
          x: clippedX,
          y,
          width: clippedW,
          height: trackHeight,
          r: 4,
        },
        style: api.style({
          stroke: 'rgba(255,255,255,0.2)',
          lineWidth: 1,
        }),
      },
      {
        type: 'text',
        silent: true,
        style: {
          x: clippedX + 4,
          y: y + trackHeight / 2,
          text: shortLabel,
          textVerticalAlign: 'middle',
          textFill: 'rgba(255,255,255,0.9)',
          fontSize: 10,
        },
      },
    ],
  }
}

function shiftWeek(delta: number) {
  const base = getUtcIsoWeekStart(selectedYear.value, selectedWeek.value)
  base.setUTCDate(base.getUTCDate() + delta * 7)
  selectedYear.value = getUtcIsoWeekYear(base)
  selectedWeek.value = getUtcIsoWeek(base)
}

function handleChartMouseDown(params: { seriesId?: string; dataIndex?: number; event?: unknown } | null) {
  if (!dragEnabled.value || persistLoading.value) return
  if (!params || params.seriesId !== 'sessionTimeline') return

  const dataIndex = Number(params.dataIndex)
  if (!Number.isFinite(dataIndex) || dataIndex < 0 || dataIndex >= segments.value.length) return

  const pointer = extractPointerOffset(params.event)
  const chart = chartRef.value
  if (!pointer || !chart) return

  const dataCoord = chart.convertFromPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [pointer.x, pointer.y]) as [number, number] | null
  if (!dataCoord) return

  const segment = segments.value[dataIndex]!
  const source = sessionsById.value.get(segment.sessionId)
  if (!source) return

  const sourceStart = new Date(source.startedAt)
  const sourceEnd = new Date(source.endedAt)
  const durationMs = sourceEnd.getTime() - sourceStart.getTime()
  if (!Number.isFinite(durationMs) || durationMs <= 0) return

  dragState.value = {
    sessionId: segment.sessionId,
    durationMs,
    offsetMinutes: dataCoord[0] - segment.startMinute,
  }
}

function handleZrMouseMove(event: { offsetX: number; offsetY: number }) {
  const state = dragState.value
  const chart = chartRef.value
  if (!state || !chart) return

  const point = chart.convertFromPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [event.offsetX, event.offsetY]) as [number, number] | null
  if (!point) return

  const rawMinute = point[0] - state.offsetMinutes
  const rawDay = Math.round(point[1])
  const dayIndex = clamp(rawDay, 0, 6)

  const snappedStartMinute = clamp(Math.round(rawMinute / SNAP_MINUTES) * SNAP_MINUTES, 0, MINUTES_PER_DAY - 1)

  const weekStartMs = weekStartDate.value.getTime()
  const weekEndMs = weekEndExclusive.value.getTime()
  const unclampedStartMs = weekStartMs + dayIndex * 86_400_000 + snappedStartMinute * 60_000
  const minStartMs = weekStartMs
  const maxStartMs = Math.max(minStartMs, weekEndMs - state.durationMs)
  const startMs = clamp(unclampedStartMs, minStartMs, maxStartMs)
  const endMs = startMs + state.durationMs

  const dayOffset = Math.floor((startMs - weekStartMs) / 86_400_000)
  const clampedDayIndex = clamp(dayOffset, 0, 6)
  const startOfDayMs = weekStartMs + clampedDayIndex * 86_400_000
  const minuteInDay = (startMs - startOfDayMs) / 60_000
  const endMinuteInDay = minuteInDay + state.durationMs / 60_000

  const startDate = new Date(startMs)
  const endDate = new Date(endMs)

  dragPreview.value = {
    sessionId: state.sessionId,
    dayIndex: clampedDayIndex,
    startMinute: minuteInDay,
    endMinute: endMinuteInDay,
    durationMinutes: state.durationMs / 60_000,
    startedAt: startDate.toISOString(),
    endedAt: endDate.toISOString(),
    hasConflict: hasSessionConflict(state.sessionId, startDate, endDate),
  }
}

function handleZrMouseUp() {
  void commitDrag()
}

function handleZrGlobalOut() {
  clearDragState()
}

async function commitDrag() {
  const state = dragState.value
  const preview = dragPreview.value
  clearDragState()

  if (!state || !preview) return
  if (preview.hasConflict) {
    toast.error('Session overlaps another session in this window')
    return
  }

  persistLoading.value = true
  try {
    const updated = await updateUserReadingSessionTimelineSession(filters.value, state.sessionId, preview.startedAt, preview.endedAt)
    timeline.value = {
      ...timeline.value,
      items: timeline.value.items.map((item) => (item.sessionId === updated.sessionId ? updated : item)),
    }
  } catch {
    toast.error('Failed to move session')
    await loadTimeline()
  } finally {
    persistLoading.value = false
  }
}

function clearDragState() {
  dragState.value = null
  dragPreview.value = null
}

function hasSessionConflict(sessionId: number, start: Date, end: Date): boolean {
  const startMs = start.getTime()
  const endMs = end.getTime()
  return timeline.value.items.some((item) => {
    if (item.sessionId === sessionId) return false
    const otherStart = new Date(item.startedAt).getTime()
    const otherEnd = new Date(item.endedAt).getTime()
    return startMs < otherEnd && endMs > otherStart
  })
}

function buildSegments(items: UserReadingSessionTimelineItem[], weekStart: Date, weekEnd: Date): SessionSegment[] {
  const byDay = new Map<number, SessionSegment[]>()

  for (const item of items) {
    const start = new Date(item.startedAt)
    const end = new Date(item.endedAt)
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) continue

    const clippedStart = start.getTime() < weekStart.getTime() ? new Date(weekStart) : start
    const clippedEnd = end.getTime() > weekEnd.getTime() ? new Date(weekEnd) : end
    if (clippedEnd <= clippedStart) continue

    let cursor = new Date(clippedStart)
    while (cursor < clippedEnd) {
      const dayStart = startOfUtcDay(cursor)
      const nextDay = addUtcDays(dayStart, 1)
      const segmentEnd = clippedEnd < nextDay ? clippedEnd : nextDay
      const dayIndex = (cursor.getUTCDay() + 6) % 7

      const startMinute = cursor.getUTCHours() * 60 + cursor.getUTCMinutes() + cursor.getUTCSeconds() / 60
      const endMinute =
        segmentEnd.getTime() === nextDay.getTime()
          ? MINUTES_PER_DAY
          : segmentEnd.getUTCHours() * 60 + segmentEnd.getUTCMinutes() + segmentEnd.getUTCSeconds() / 60

      if (!byDay.has(dayIndex)) byDay.set(dayIndex, [])
      byDay.get(dayIndex)!.push({
        sessionId: item.sessionId,
        bookId: item.bookId,
        bookTitle: item.bookTitle,
        bookFormat: item.bookFormat,
        dayIndex,
        startMinute,
        endMinute: Math.max(startMinute + 0.5, endMinute),
        durationMinutes: Math.max((segmentEnd.getTime() - cursor.getTime()) / 60_000, 0.5),
        track: 0,
        totalTracks: 1,
      })

      cursor = new Date(segmentEnd)
    }
  }

  const output: SessionSegment[] = []
  for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
    const daySegments = byDay.get(dayIndex) ?? []
    daySegments.sort((a, b) => (a.startMinute === b.startMinute ? b.endMinute - a.endMinute : a.startMinute - b.startMinute))

    const tracks: number[] = []
    for (const segment of daySegments) {
      let trackIndex = -1
      for (let i = 0; i < tracks.length; i++) {
        if (segment.startMinute >= tracks[i]!) {
          trackIndex = i
          break
        }
      }

      if (trackIndex === -1) {
        if (tracks.length < MAX_TRACKS) {
          tracks.push(segment.endMinute)
          trackIndex = tracks.length - 1
        } else {
          trackIndex = MAX_TRACKS - 1
          tracks[trackIndex] = Math.max(tracks[trackIndex] ?? 0, segment.endMinute)
        }
      } else {
        tracks[trackIndex] = segment.endMinute
      }

      output.push({
        ...segment,
        track: trackIndex,
        totalTracks: Math.max(1, Math.min(MAX_TRACKS, tracks.length)),
      })
    }
  }

  return output
}

function extractPointerOffset(eventLike: unknown): PointerOffset | null {
  if (typeof eventLike !== 'object' || !eventLike) return null
  const maybe = eventLike as { offsetX?: number; offsetY?: number; event?: { offsetX?: number; offsetY?: number } }
  if (typeof maybe.offsetX === 'number' && typeof maybe.offsetY === 'number') {
    return { x: maybe.offsetX, y: maybe.offsetY }
  }
  if (typeof maybe.event?.offsetX === 'number' && typeof maybe.event?.offsetY === 'number') {
    return { x: maybe.event.offsetX, y: maybe.event.offsetY }
  }
  return null
}

function formatDateLabel(ymd: string): string {
  const parts = ymd.split('-').map((p) => Number(p))
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return ymd
  const [year, month, day] = parts
  const date = new Date(year!, (month ?? 1) - 1, day ?? 1)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatHourLabel(minutes: number): string {
  const hour24 = Math.floor(minutes / 60)
  if (!Number.isFinite(hour24)) return ''
  const hour = ((hour24 % 24) + 24) % 24
  if (hour === 0) return '12a'
  if (hour < 12) return `${hour}a`
  if (hour === 12) return '12p'
  return `${hour - 12}p`
}

function formatTimeLabel(minutes: number): string {
  const normalized = clamp(minutes, 0, MINUTES_PER_DAY)
  const clockMinutes = normalized === MINUTES_PER_DAY ? 0 : normalized
  const hour24 = Math.floor(clockMinutes / 60)
  const minute = Math.floor(clockMinutes % 60)
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  const period = hour24 < 12 ? 'AM' : 'PM'
  return `${hour12}:${String(minute).padStart(2, '0')} ${period}`
}

function formatDuration(minutes: number): string {
  const totalSeconds = Math.round(minutes * 60)
  const hours = Math.floor(totalSeconds / 3600)
  const mins = Math.floor((totalSeconds % 3600) / 60)
  const secs = totalSeconds % 60

  if (hours > 0) return `${hours}h ${mins}m ${secs}s`
  if (mins > 0) return `${mins}m ${secs}s`
  return `${secs}s`
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function parseYmdUtc(value: string): Date | null {
  const [yearStr, monthStr, dayStr] = value.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  return new Date(Date.UTC(year, month - 1, day))
}

function formatYmd(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function startOfUtcIsoWeek(date: Date): Date {
  const start = startOfUtcDay(date)
  const day = (start.getUTCDay() + 6) % 7
  start.setUTCDate(start.getUTCDate() - day)
  return start
}

function getUtcIsoWeekYear(date: Date): number {
  const d = startOfUtcDay(date)
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day + 3)
  return d.getUTCFullYear()
}

function getUtcIsoWeek(date: Date): number {
  const d = startOfUtcDay(date)
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day + 3)
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const firstDay = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3)
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / 604_800_000)
}

function getUtcIsoWeeksInYear(year: number): number {
  return getUtcIsoWeek(new Date(Date.UTC(year, 11, 28)))
}

function getUtcIsoWeekStart(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const week1Start = startOfUtcIsoWeek(jan4)
  const start = new Date(week1Start)
  start.setUTCDate(start.getUTCDate() + (week - 1) * 7)
  return start
}
</script>

<template>
  <ChartCard title="Reading Session Timeline" :icon="CalendarRange" :color-index="11" :loading="loading" :error="error" :empty="false">
    <template #controls>
      <button
        type="button"
        :disabled="persistLoading"
        :class="[
          'border-border rounded-md border px-2 py-1 text-xs transition-colors',
          dragEnabled ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
          persistLoading && 'pointer-events-none opacity-50',
        ]"
        @click="dragEnabled = !dragEnabled"
      >
        {{ dragEnabled ? 'Drag: On' : 'Drag: Off' }}
      </button>
    </template>

    <div class="flex h-full min-h-0 flex-col gap-2">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-1.5">
          <button
            type="button"
            class="border-border text-muted-foreground hover:text-foreground rounded-md border px-2 py-1 text-xs"
            :disabled="persistLoading"
            @click="shiftWeek(-1)"
          >
            Prev
          </button>

          <button
            type="button"
            class="border-border text-muted-foreground hover:text-foreground rounded-md border px-2 py-1 text-xs"
            :disabled="persistLoading"
            @click="shiftWeek(1)"
          >
            Next
          </button>

          <select
            v-model.number="selectedYear"
            class="border-border bg-background text-foreground rounded-md border px-2 py-1 text-xs"
            :disabled="persistLoading"
          >
            <option v-for="year in yearOptions" :key="year" :value="year">{{ year }}</option>
          </select>

          <select
            v-model.number="selectedWeek"
            class="border-border bg-background text-foreground rounded-md border px-2 py-1 text-xs"
            :disabled="persistLoading"
          >
            <option v-for="week in weekOptions" :key="week" :value="week">Week {{ week }}</option>
          </select>
        </div>

        <p class="text-muted-foreground text-xs">{{ weekRangeLabel }}</p>
      </div>

      <p v-if="dragEnabled" class="text-muted-foreground border-border/60 bg-muted/20 rounded-md border px-2 py-1 text-xs">
        Drag bars to move sessions. Duration is locked and overlapping sessions are rejected.
      </p>

      <div class="border-border/60 bg-muted/5 min-h-0 flex-1 rounded-lg border p-2">
        <div v-if="isEmpty" class="text-muted-foreground flex h-full flex-col items-center justify-center gap-1 text-center">
          <p class="text-sm font-medium">No data yet</p>
          <p class="text-xs opacity-70">No sessions for this week. Use Prev/Next or week selector.</p>
        </div>

        <VChart
          v-else
          ref="chartRef"
          :option="option"
          autoresize
          class="h-full w-full"
          @mousedown="handleChartMouseDown"
          @zr:mousemove="handleZrMouseMove"
          @zr:mouseup="handleZrMouseUp"
          @zr:globalout="handleZrGlobalOut"
        />
      </div>
    </div>
  </ChartCard>
</template>
