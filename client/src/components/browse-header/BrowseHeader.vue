<script setup lang="ts">
import { onActivated, onBeforeUnmount, onDeactivated, provide, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import PageTitleRow from '@/components/page-header/PageTitleRow.vue'
import PageMenuButton from '@/components/page-header/PageMenuButton.vue'
import BrowseTitleSwitcher from './BrowseTitleSwitcher.vue'
import { BROWSE_BAR_KEY, barDivider, type BrowsePlace } from './browse-header'

/**
 * The browse pages' header: a title row naming the place, and one command bar for finding and
 * arranging what is in it. Nothing else stacks here, so the grid starts right under the bar; when
 * the page scrolls the title row folds away and the bar carries a small copy of the title.
 */
const props = defineProps<{
  eyebrow: string
  title: string
  icon?: string | null
  fallbackIcon?: string
  /** The count shown beside the title when the title row is folded. */
  foldedCount?: string
  switcher?: BrowsePlace | null
  /** The view's scroller; the title row folds once it has moved past the first rows. */
  scrollContainer?: HTMLElement | null
}>()

const FOLD_AT = 64
const UNFOLD_AT = 8

const barRef = ref<HTMLElement | null>(null)
provide(BROWSE_BAR_KEY, barRef)

const folded = ref(false)
let listening: HTMLElement | null = null

function handleScroll() {
  const top = listening?.scrollTop ?? 0
  if (!folded.value && top > FOLD_AT) folded.value = true
  else if (folded.value && top < UNFOLD_AT) folded.value = false
}

function attach(el: HTMLElement | null | undefined) {
  if (listening === el) return
  detach()
  if (!el) return
  listening = el
  el.addEventListener('scroll', handleScroll, { passive: true })
  handleScroll()
}

function detach() {
  listening?.removeEventListener('scroll', handleScroll)
  listening = null
}

watch(() => props.scrollContainer, attach, { immediate: true })
onActivated(() => attach(props.scrollContainer))
onDeactivated(detach)
onBeforeUnmount(detach)
</script>

<template>
  <!-- Folded, the bar is the page's top box, so it meets the sidebar's top edge instead of
       keeping the title row's offset. -->
  <header
    class="mb-3 flex shrink-0 flex-col transition-[margin] duration-200 ease-out motion-reduce:transition-none"
    :class="folded ? 'mt-0' : 'mt-2'"
  >
    <div
      class="grid transition-[grid-template-rows,opacity,margin] duration-200 ease-out motion-reduce:transition-none"
      :class="folded ? 'mb-0 grid-rows-[0fr] opacity-0' : 'mb-3 grid-rows-[1fr] opacity-100'"
      :inert="folded || undefined"
    >
      <div class="min-h-0 overflow-hidden">
        <PageTitleRow :eyebrow="eyebrow" :title="title" :icon="icon" :fallback-icon="fallbackIcon">
          <template v-if="switcher" #title>
            <BrowseTitleSwitcher :place="switcher" :title="title" />
          </template>
          <template v-if="$slots.facts" #facts>
            <slot name="facts" />
          </template>
          <template v-if="$slots.actions" #actions>
            <slot name="actions" />
          </template>
        </PageTitleRow>
      </div>
    </div>

    <div ref="barRef" class="flex h-12 min-w-0 items-center gap-1 rounded-[10px] border border-border bg-card px-[7px] shadow-xs">
      <template v-if="folded">
        <div class="flex shrink-0 items-center gap-2 ps-1 pe-1">
          <PageMenuButton class="-ms-1 size-8" />
          <span class="grid size-[26px] place-items-center rounded-[7px] bg-primary/12 text-primary" aria-hidden="true">
            <AppIcon :icon="icon" :fallback="fallbackIcon" :size="15" />
          </span>
          <span class="max-w-[14rem] truncate text-[15px] font-bold tracking-[-0.01em] text-foreground">{{ title }}</span>
          <span v-if="foldedCount" class="text-[12.5px] text-muted-foreground tabular-nums">{{ foldedCount }}</span>
        </div>
        <span :class="barDivider" aria-hidden="true" />
      </template>
      <slot name="bar" />
    </div>
  </header>
</template>
