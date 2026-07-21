<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { TransitionPresets, useElementBounding, useMediaQuery, useTransition } from '@vueuse/core'
import type { JumpBucket, JumpBucketKind, SortField, TemporalJumpBucketGranularity } from '@bookorbit/types'
import { useI18n } from 'vue-i18n'
import { useJumpRailSlots, type JumpRailSlot as RailSlot } from '../composables/useJumpRailSlots'

const { t } = useI18n()

const SLOT_PX = 20
const RAIL_PAD_PX = 8
const SCROLL_PULSE_MS = 900

const props = defineProps<{
  visible: boolean
  buckets: JumpBucket[]
  kind: JumpBucketKind
  field: SortField
  granularity?: TemporalJumpBucketGranularity | null
  activeKey: string | null
  template?: string[]
  maxSlots?: number
  viewport?: HTMLElement | null
}>()

const emit = defineEmits<{
  jump: [bucket: JumpBucket]
  'after-leave': []
}>()

const railEl = ref<HTMLElement | null>(null)
const viewportTarget = computed(() => props.viewport ?? null)
const { top: viewportTop, height: viewportHeight } = useElementBounding(viewportTarget)
const railPositionStyle = computed(() => {
  if (viewportHeight.value <= 0) return undefined
  return {
    top: `${viewportTop.value + viewportHeight.value / 2}px`,
    maxHeight: `${viewportHeight.value * 0.85}px`,
  }
})

const slots = useJumpRailSlots({
  buckets: () => props.buckets,
  kind: () => props.kind,
  field: () => props.field,
  granularity: () => props.granularity,
  template: () => props.template,
  maxSlots: () => props.maxSlots,
})

const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

const scrubbing = ref(false)
const hovering = ref(false)
const scrollPulse = ref(false)
let scrollPulseTimer: ReturnType<typeof setTimeout> | null = null

const engaged = computed(() => hovering.value || scrubbing.value || scrollPulse.value)

// The target index never resets to 0 so the hover or scrub indicator moves
// between slots instead of sliding up from the top each time it reappears.
const hoveredIndex = ref<number | null>(null)
const hoverTargetIndex = ref(0)
watch(hoveredIndex, (value) => {
  if (value !== null) hoverTargetIndex.value = value
})
const hoverVisible = computed(() => hoveredIndex.value !== null)
const previewSlot = computed(() => (hoveredIndex.value === null ? null : (slots.value[hoveredIndex.value] ?? null)))
const hoverThumbIndex = useTransition(hoverTargetIndex, {
  duration: 220,
  transition: TransitionPresets.easeOutBack,
  disabled: reducedMotion,
})
const hoverThumbY = computed(() => RAIL_PAD_PX + hoverThumbIndex.value * SLOT_PX)

watch(
  () => props.activeKey,
  () => {
    scrollPulse.value = true
    if (scrollPulseTimer) clearTimeout(scrollPulseTimer)
    scrollPulseTimer = setTimeout(() => {
      scrollPulse.value = false
      scrollPulseTimer = null
    }, SCROLL_PULSE_MS)
  },
)

let lastScrubKey: string | null = null

onBeforeUnmount(() => {
  if (scrollPulseTimer) clearTimeout(scrollPulseTimer)
})

function slotAtClientY(clientY: number): RailSlot | null {
  const el = railEl.value
  const list = slots.value
  if (!el || list.length === 0) return null
  const rect = el.getBoundingClientRect()
  if (rect.height <= 0) return null
  const ratio = Math.min(0.999, Math.max(0, (clientY - rect.top) / rect.height))
  return list[Math.floor(ratio * list.length)] ?? null
}

function nearestAvailable(slot: RailSlot | null): RailSlot | null {
  if (!slot) return null
  if (slot.bucket) return slot
  const list = slots.value
  const start = list.indexOf(slot)
  for (let distance = 1; distance < list.length; distance++) {
    const before = list[start - distance]
    if (before?.bucket) return before
    const after = list[start + distance]
    if (after?.bucket) return after
  }
  return null
}

function pulseHaptics(pointerType: string) {
  if (pointerType === 'mouse') return
  navigator.vibrate?.(5)
}

function scrubTo(clientY: number, pointerType: string) {
  const slot = nearestAvailable(slotAtClientY(clientY))
  if (!slot?.bucket) return
  hoveredIndex.value = slots.value.indexOf(slot)
  if (slot.key === lastScrubKey) return
  lastScrubKey = slot.key
  pulseHaptics(pointerType)
  emit('jump', slot.bucket)
}

function handlePointerDown(event: PointerEvent) {
  railEl.value?.setPointerCapture(event.pointerId)
  scrubbing.value = true
  scrubTo(event.clientY, event.pointerType)
}

function handlePointerMove(event: PointerEvent) {
  if (event.pointerType === 'mouse') {
    const slot = slotAtClientY(event.clientY)
    hoveredIndex.value = slot?.bucket ? slots.value.indexOf(slot) : null
  }
  if (scrubbing.value) scrubTo(event.clientY, event.pointerType)
}

function handlePointerEnter(event: PointerEvent) {
  if (event.pointerType === 'mouse') hovering.value = true
}

function handlePointerEnd(event: PointerEvent) {
  scrubbing.value = false
  if (event.pointerType !== 'mouse') hoveredIndex.value = null
}

function handlePointerLeave() {
  hovering.value = false
  hoveredIndex.value = null
}

function handleSlotClick(slot: RailSlot) {
  if (!slot.bucket) return
  // A tap already jumped via pointerdown scrubbing; skip the duplicate click.
  if (slot.key === lastScrubKey) {
    lastScrubKey = null
    return
  }
  lastScrubKey = null
  emit('jump', slot.bucket)
}

function handleAfterLeave() {
  emit('after-leave')
}
</script>

<template>
  <Transition
    enter-active-class="transition-all duration-200 ease-out"
    leave-active-class="transition-all duration-150 ease-in"
    enter-from-class="opacity-0 translate-x-2"
    leave-to-class="opacity-0 translate-x-2"
    @after-leave="handleAfterLeave"
  >
    <nav
      v-if="visible"
      ref="railEl"
      class="jump-rail fixed right-1.5 top-1/2 z-30 flex max-h-[85vh] -translate-y-1/2 select-none flex-col items-stretch overflow-visible rounded-2xl border border-primary/20 bg-background/80 py-2 shadow-sm backdrop-blur"
      :class="[
        kind === 'category' ? 'w-20 px-1' : kind === 'temporal' ? 'w-12 px-0.5' : engaged ? 'w-8 px-1' : 'w-7 px-0.5',
        reducedMotion ? '' : 'transition-[width,padding] duration-300 ease-out',
      ]"
      :style="railPositionStyle"
      :aria-label="t('book.jumpRail.jumpToSection')"
      data-testid="jump-rail"
      @pointerdown="handlePointerDown"
      @pointermove="handlePointerMove"
      @pointerenter="handlePointerEnter"
      @pointerup="handlePointerEnd"
      @pointercancel="handlePointerEnd"
      @pointerleave="handlePointerLeave"
    >
      <div
        v-show="hoverVisible"
        class="jump-rail-thumb pointer-events-none absolute inset-x-1 top-0 z-0 h-5 rounded-full bg-foreground/10 transition-opacity duration-150"
        :style="{ transform: `translateY(${hoverThumbY}px)` }"
        aria-hidden="true"
      />

      <div
        v-if="kind !== 'letter' && previewSlot"
        class="pointer-events-none absolute right-full top-0 z-20 mr-2 flex h-7 -translate-y-1 items-center whitespace-nowrap rounded-md border border-border bg-popover px-2.5 text-xs font-medium tabular-nums text-popover-foreground shadow-md"
        :style="{ transform: `translateY(${hoverThumbY - 4}px)` }"
        aria-hidden="true"
        data-testid="jump-rail-preview"
      >
        {{ previewSlot.label }}
      </div>

      <button
        v-for="(slot, index) in slots"
        :key="slot.key"
        type="button"
        class="jump-rail-slot relative z-10 h-5 shrink-0 items-center px-0.5 text-center text-[11px] font-medium tabular-nums transition-colors duration-150"
        :class="[
          'flex justify-center rounded-full',
          slot.bucket ? 'text-muted-foreground hover:text-foreground' : 'cursor-default text-muted-foreground/30',
          index === hoveredIndex && kind === 'letter' ? 'scale-[1.35] font-semibold text-foreground' : '',
        ]"
        :disabled="!slot.bucket"
        :aria-label="t('book.jumpRail.jumpTo', { label: slot.accessibleLabel })"
        :aria-current="slot.key === activeKey ? 'true' : undefined"
        :data-key="slot.key"
        @click="handleSlotClick(slot)"
      >
        <span
          v-if="slot.displayLabel"
          class="rounded-full leading-4"
          :class="[
            kind === 'category' ? 'max-w-full truncate px-1.5' : 'px-1',
            slot.key === activeKey ? 'bg-primary font-semibold text-primary-foreground shadow-sm' : '',
          ]"
        >
          {{ slot.displayLabel }}
        </span>
        <span
          v-else
          class="rounded-full"
          :class="slot.key === activeKey ? 'size-1.5 bg-primary opacity-100' : 'size-1 bg-current opacity-60'"
          aria-hidden="true"
        />
      </button>
    </nav>
  </Transition>
</template>

<style scoped>
.jump-rail {
  touch-action: none;
  contain: layout style;
}

.jump-rail-slot {
  -webkit-tap-highlight-color: transparent;
}
</style>
