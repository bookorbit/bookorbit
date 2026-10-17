<script setup lang="ts">
import { cn } from '@/lib/utils'
import { inject, nextTick, onMounted, ref } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import { ChevronDown } from '@lucide/vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { BROWSE_BAR_KEY, barButton, barButtonOn, facetLabel } from './browse-header'

/**
 * A facet group that sits inline in the command bar while it fits beside a usable search field,
 * and otherwise folds into one dropdown in the same place. Fit is measured against the bar's own
 * width and the group's real rendered width, so a collapsed sidebar or a longer translation moves
 * the switch point rather than wrapping the bar onto a second row.
 */
const props = withDefaults(
  defineProps<{
    label: string
    /** What the folded button says is picked, if anything. */
    value?: string | null
    active?: boolean
    showLabel?: boolean
    /** Leave the phone bar to search: the filter popover covers the same ground there. */
    hideOnPhone?: boolean
    popoverClass?: string
  }>(),
  { value: null, active: false, showLabel: true, hideOnPhone: false, popoverClass: 'w-auto max-w-[min(560px,calc(100vw-24px))] p-3' },
)

const SEARCH_MIN = 240
const HYSTERESIS = 16

const bar = inject(BROWSE_BAR_KEY, ref(null))
const rootRef = ref<HTMLElement | null>(null)
const measureRef = ref<HTMLElement | null>(null)
const inline = ref(false)

function measure() {
  const barEl = bar.value
  const root = rootRef.value
  const measurer = measureRef.value
  if (!barEl || !root || !measurer) return
  const style = getComputedStyle(barEl)
  const gap = parseFloat(style.columnGap) || 0
  let used = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
  let visible = 0
  for (const child of Array.from(barEl.children) as HTMLElement[]) {
    if (child.offsetParent === null && getComputedStyle(child).position !== 'fixed') continue
    visible += 1
    if (child === root || child.hasAttribute('data-browse-grow')) continue
    used += child.getBoundingClientRect().width
  }
  used += gap * Math.max(0, visible - 1)
  const available = barEl.clientWidth - used - SEARCH_MIN
  const natural = measurer.scrollWidth
  inline.value = natural <= available - (inline.value ? 0 : HYSTERESIS)
}

useResizeObserver(bar, measure)
useResizeObserver(measureRef, measure)
onMounted(() => {
  void nextTick(measure)
  void document.fonts?.ready.then(measure)
})

defineExpose({ measure })
</script>

<template>
  <div ref="rootRef" class="shrink-0 items-center" :class="hideOnPhone ? 'hidden md:flex' : 'flex'">
    <div ref="measureRef" class="pointer-events-none invisible fixed top-0 -left-[9999px] flex items-center gap-1.5" aria-hidden="true" inert>
      <span v-if="showLabel" :class="[facetLabel, 'ms-1 me-0.5']">{{ label }}</span>
      <slot />
    </div>

    <div v-if="inline" class="flex items-center gap-1.5" role="group" :aria-label="label">
      <span v-if="showLabel" :class="[facetLabel, 'ms-1 me-0.5']" aria-hidden="true">{{ label }}</span>
      <slot />
    </div>

    <Popover v-else>
      <PopoverTrigger as-child>
        <button type="button" :class="cn(barButton, props.active && barButtonOn)" :title="label">
          <slot name="icon" />
          <span v-if="value" class="hidden text-muted-foreground xl:inline">{{ label }}</span>
          <span class="max-w-[10rem] truncate">{{ value ?? label }}</span>
          <ChevronDown :size="13" class="-ms-0.5" :class="props.active ? 'text-primary' : 'text-muted-foreground'" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" :class="popoverClass">
        <div class="flex flex-wrap items-center gap-1.5" role="group" :aria-label="label">
          <slot />
        </div>
      </PopoverContent>
    </Popover>
  </div>
</template>
