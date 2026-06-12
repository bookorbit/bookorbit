<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { TransitionPresets, useElementSize, useMediaQuery, useTransition } from '@vueuse/core'
import type { JumpBucket, JumpBucketKind } from '@bookorbit/types'

const SLOT_PX = 20
const RAIL_PAD_PX = 8
const SCROLL_PULSE_MS = 900

type RailSlot = {
  key: string
  label: string
  bucket: JumpBucket | null
}

const props = defineProps<{
  visible: boolean
  buckets: JumpBucket[]
  kind: JumpBucketKind
  activeKey: string | null
  template?: string[]
}>()

const emit = defineEmits<{
  jump: [bucket: JumpBucket]
  'after-leave': []
}>()

const railEl = ref<HTMLElement | null>(null)
const { height: railHeight } = useElementSize(railEl)

const slots = computed<RailSlot[]>(() => {
  if (props.kind === 'letter' && props.template) {
    const byKey = new Map(props.buckets.map((bucket) => [bucket.key, bucket]))
    return props.template.map((key) => ({ key, label: key, bucket: byKey.get(key) ?? null }))
  }

  const all = props.buckets.map((bucket) => ({ key: bucket.key, label: bucket.label, bucket }))
  const max = Math.max(2, Math.floor((railHeight.value || 480) / SLOT_PX))
  if (all.length <= max) return all

  // Thin evenly to fit the rail height, always keeping the first and last.
  const step = (all.length - 1) / (max - 1)
  const picked: RailSlot[] = []
  const used = new Set<number>()
  for (let i = 0; i < max; i++) {
    const index = Math.round(i * step)
    if (used.has(index)) continue
    used.add(index)
    picked.push(all[index]!)
  }
  return picked
})

const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

const scrubbing = ref(false)
const hovering = ref(false)
const scrollPulse = ref(false)
let scrollPulseTimer: ReturnType<typeof setTimeout> | null = null

const engaged = computed(() => hovering.value || scrubbing.value || scrollPulse.value)

const activeIndex = computed(() => (props.activeKey ? slots.value.findIndex((slot) => slot.key === props.activeKey) : -1))
const lozengeVisible = computed(() => activeIndex.value >= 0)
const lozengeIndex = useTransition(
  computed(() => Math.max(0, activeIndex.value)),
  { duration: 300, transition: TransitionPresets.easeOutBack, disabled: reducedMotion },
)
const lozengeY = computed(() => RAIL_PAD_PX + lozengeIndex.value * SLOT_PX)

// Hover capsule: a soft pill that glides to the slot under the cursor (mouse
// only). The target index never resets to 0 so the pill springs between
// letters instead of sliding up from the top each time it reappears.
const hoveredIndex = ref<number | null>(null)
const hoverTargetIndex = ref(0)
watch(hoveredIndex, (value) => {
  if (value !== null) hoverTargetIndex.value = value
})
const hoverVisible = computed(() => hoveredIndex.value !== null)
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

function handlePointerEnd() {
  scrubbing.value = false
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
      class="jump-rail fixed right-1.5 top-1/2 z-30 flex max-h-[85vh] -translate-y-1/2 select-none flex-col items-stretch overflow-hidden rounded-full border border-border bg-background/85 py-2 shadow-sm backdrop-blur"
      :class="[engaged ? 'px-1.5' : 'px-1', reducedMotion ? '' : 'transition-[padding] duration-300 ease-out']"
      aria-label="Jump to section"
      data-testid="jump-rail"
      @pointerdown="handlePointerDown"
      @pointermove="handlePointerMove"
      @pointerenter="handlePointerEnter"
      @pointerup="handlePointerEnd"
      @pointercancel="handlePointerEnd"
      @pointerleave="handlePointerLeave"
    >
      <div
        v-show="lozengeVisible"
        class="jump-rail-lozenge pointer-events-none absolute inset-x-1 top-0 z-0 h-5 rounded-full bg-primary shadow-sm"
        :style="{ transform: `translateY(${lozengeY}px)` }"
        aria-hidden="true"
      />

      <div
        v-show="hoverVisible"
        class="jump-rail-thumb pointer-events-none absolute inset-x-1 top-0 z-0 h-5 rounded-full bg-foreground/10 transition-opacity duration-150"
        :style="{ transform: `translateY(${hoverThumbY}px)` }"
        aria-hidden="true"
      />

      <button
        v-for="(slot, index) in slots"
        :key="slot.key"
        type="button"
        class="jump-rail-slot relative z-10 flex h-5 shrink-0 items-center justify-center rounded-full px-1 text-center text-[11px] font-medium tabular-nums transition-[color,transform] duration-150"
        :class="[
          slot.bucket
            ? slot.key === activeKey
              ? 'text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'
            : 'cursor-default text-muted-foreground/30',
          index === hoveredIndex ? 'scale-[1.35] font-semibold text-foreground' : '',
        ]"
        :disabled="!slot.bucket"
        :aria-label="`Jump to ${slot.label}`"
        :aria-current="slot.key === activeKey ? 'true' : undefined"
        :data-key="slot.key"
        @click="handleSlotClick(slot)"
      >
        {{ slot.label }}
      </button>
    </nav>
  </Transition>
</template>

<style scoped>
.jump-rail {
  touch-action: none;
  contain: layout paint style;
}

.jump-rail-slot {
  -webkit-tap-highlight-color: transparent;
}
</style>
