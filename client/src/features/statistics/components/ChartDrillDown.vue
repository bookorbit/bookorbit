<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRouter } from 'vue-router'

import AppChart from '@/components/charts/AppChart.vue'
import { useOpenInNewTab } from '@/composables/useOpenInNewTab'
import { categoryIndexAtPixel, nextTargetPosition, windowShowing, type ChartDrillDownHit, type ChartDrillDownTarget } from '../lib/chart-drill-down'

/**
 * A chart whose entries open pages. A click opens the entry (Ctrl/Cmd+click a new tab). A touch
 * shows the tooltip first and opens on a second tap of the same entry, so a number can be read
 * without leaving. Keyboard and screen readers get one Tab stop holding a hidden link per entry:
 * arrows move between them, the chart's tooltip follows focus, Enter opens.
 */
const props = defineProps<{
  option: Record<string, unknown>
  /** In reading order, the order the arrow keys move through. */
  targets: ChartDrillDownTarget[]
  label: string
  hit: ChartDrillDownHit
}>()

interface ChartClickParams {
  componentType?: string
  seriesIndex?: number
  dataIndex?: number
  targetType?: string
  event?: { event?: Event }
}

interface ZrPointerEvent {
  offsetX: number
  offsetY: number
  event?: Event
}

interface DataZoomState {
  start?: number
  end?: number
  startValue?: number
  endValue?: number
}

const { t } = useI18n()
const router = useRouter()
const { openInNewTabIfRequested } = useOpenInNewTab()
const root = useTemplateRef<HTMLElement>('root')
const chartRef = useTemplateRef<InstanceType<typeof AppChart>>('chart')
const focusPosition = ref(0)
const rovingPosition = computed(() => Math.min(focusPosition.value, Math.max(props.targets.length - 1, 0)))

let pointerType = 'mouse'
let armedIndex: number | null = null
let shownIndex: number | null = null

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

const chartOption = computed<Record<string, unknown>>(() => {
  const tooltip = props.option.tooltip as Record<string, unknown> | undefined
  const formatter = tooltip?.formatter
  if (typeof formatter !== 'function') return props.option
  return {
    ...props.option,
    tooltip: {
      ...tooltip,
      formatter: (...args: unknown[]) => {
        const html: unknown = formatter(...args)
        if (typeof html !== 'string' || !html || pointerType !== 'touch') return html
        return `${html}<br/><span style="font-size: 11px">${escapeHtml(t('statistics.drillDown.tapAgain'))}</span>`
      },
    },
  }
})

function chartApi() {
  return chartRef.value?.instance ?? null
}

function targetFor(dataIndex: number | undefined): ChartDrillDownTarget | null {
  return props.targets.find((target) => target.dataIndex === dataIndex) ?? null
}

function scrollIntoView(dataIndex: number) {
  const api = chartApi()
  if (!api) return
  const zoom = (api.getOption() as { dataZoom?: DataZoomState[] }).dataZoom?.[0]
  if (!zoom) return
  // A pan stores the window as percentages and drops the values, so convert back to positions.
  const last = Math.max(props.targets.length - 1, 0)
  const start = zoom.startValue ?? (zoom.start === undefined ? null : Math.round((zoom.start / 100) * last))
  const end = zoom.endValue ?? (zoom.end === undefined ? null : Math.round((zoom.end / 100) * last))
  if (start === null || end === null) return
  const next = windowShowing({ start, end }, dataIndex)
  if (next) api.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, startValue: next.start, endValue: next.end })
}

function showEntry(dataIndex: number) {
  const api = chartApi()
  if (!api) return
  scrollIntoView(dataIndex)
  if (shownIndex !== null && shownIndex !== dataIndex) api.dispatchAction({ type: 'downplay', seriesIndex: 0, dataIndex: shownIndex })
  api.dispatchAction({ type: 'highlight', seriesIndex: 0, dataIndex })
  api.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex })
  shownIndex = dataIndex
}

function hideEntry() {
  const api = chartApi()
  if (!api) return
  if (shownIndex !== null) api.dispatchAction({ type: 'downplay', seriesIndex: 0, dataIndex: shownIndex })
  api.dispatchAction({ type: 'hideTip' })
  shownIndex = null
}

function open(dataIndex: number | undefined, event: Event | undefined) {
  const target = targetFor(dataIndex)
  if (!target) return
  if (pointerType === 'touch' && armedIndex !== target.dataIndex) {
    armedIndex = target.dataIndex
    showEntry(target.dataIndex)
    return
  }
  armedIndex = null
  if (event instanceof MouseEvent && openInNewTabIfRequested(event, target.to)) return
  void router.push(target.to)
}

function handlePointerDown(event: PointerEvent) {
  pointerType = event.pointerType
}

function handleChartClick(params: ChartClickParams) {
  const onEntry =
    props.hit === 'item'
      ? params.componentType === 'series' && params.seriesIndex === 0
      : params.componentType === 'yAxis' && params.targetType === 'axisLabel'
  if (onEntry) open(params.dataIndex, params.event?.event)
}

function handleZrClick(event: ZrPointerEvent) {
  if (props.hit !== 'category') return
  const api = chartApi()
  if (!api) return
  const index = categoryIndexAtPixel(api, event.offsetX, event.offsetY)
  if (index !== null) open(index, event.event)
}

function handleZrMove(event: ZrPointerEvent) {
  if (props.hit !== 'category') return
  const api = chartApi()
  if (api && categoryIndexAtPixel(api, event.offsetX, event.offsetY) !== null) api.getZr().setCursorStyle('pointer')
}

function handleLinkFocus(position: number) {
  focusPosition.value = position
  const target = props.targets[position]
  if (target) showEntry(target.dataIndex)
}

function handleLinkBlur() {
  hideEntry()
}

function handleLinkKeydown(event: KeyboardEvent) {
  const next = nextTargetPosition(rovingPosition.value, event.key, props.targets.length)
  if (next === null) return
  event.preventDefault()
  focusPosition.value = next
  root.value?.querySelectorAll<HTMLElement>('[data-drill-link]')[next]?.focus()
}
</script>

<template>
  <div ref="root" class="focus-within:ring-ring/50 relative h-full rounded-md focus-within:ring-[3px]" @pointerdown.capture="handlePointerDown">
    <AppChart
      ref="chart"
      :option="chartOption"
      autoresize
      style="height: 100%"
      @click="handleChartClick"
      @zr:click="handleZrClick"
      @zr:mousemove="handleZrMove"
    />
    <ul class="sr-only" :aria-label="label">
      <li v-for="(target, position) in targets" :key="target.dataIndex">
        <RouterLink
          data-drill-link
          :to="target.to"
          :tabindex="position === rovingPosition ? 0 : -1"
          @focus="handleLinkFocus(position)"
          @blur="handleLinkBlur"
          @keydown="handleLinkKeydown"
        >
          {{ target.text }}
        </RouterLink>
      </li>
    </ul>
  </div>
</template>
