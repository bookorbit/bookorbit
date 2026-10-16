<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { TriangleAlert } from '@lucide/vue'
import type { FontFamily } from '@/features/reader/epub/composables/useCustomFonts'
import { useFontLabels } from '../composables/useFontLabels'
import FontStyleGrid from './FontStyleGrid.vue'

/**
 * One family as a ledger row: its name in its own face, a specimen, the styles it really has, how it
 * is used, and one trailing control. The page decides what the use column says and what the control is.
 */
const props = withDefaults(
  defineProps<{
    family: FontFamily
    previewText: string
    previewSize: number
    isNew?: boolean
    /** The browser refused the family's files, so readers see a fallback face. */
    loadFailed?: boolean
    /** Set in the muted colour, for a family the reader has hidden from their picker. */
    muted?: boolean
  }>(),
  { isNew: false, loadFailed: false, muted: false },
)

const emit = defineEmits<{ open: [name: string] }>()

const { t } = useI18n()
const { styleSummaryText, fileCountSummary } = useFontLabels()

const fontFamily = computed(() => `'${props.family.cssFamilyName}', sans-serif`)
const summary = computed(() => styleSummaryText(props.family.variants))
// Scales down with the row on narrow screens, so a 32 px preview does not dwarf a phone.
const specimenStyle = computed(() => ({ fontFamily: fontFamily.value, fontSize: `min(${props.previewSize}px, 6cqi)`, lineHeight: 1.35 }))

function handleOpen() {
  emit('open', props.family.name)
}
</script>

<template>
  <div
    class="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2.5 rounded-xl border border-border bg-card px-4 py-3.5 shadow-xs transition-colors hover:border-foreground/15 @min-[60rem]:grid-cols-[12rem_minmax(0,1fr)_8.75rem_9rem_2.25rem] @min-[60rem]:items-center @min-[60rem]:gap-x-5 @min-[60rem]:py-[17px] @min-[60rem]:ps-6 @min-[60rem]:pe-5"
    :class="isNew ? 'bg-[linear-gradient(90deg,color-mix(in_oklch,var(--success)_9%,transparent),transparent_40%)]' : ''"
    data-testid="font-family-row"
    @click="handleOpen"
  >
    <div class="order-1 flex min-w-0 flex-col gap-0.5">
      <button
        type="button"
        class="block max-w-full truncate rounded-sm text-start text-[21px] leading-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :class="muted ? 'text-muted-foreground' : 'text-foreground'"
        :style="{ fontFamily }"
      >
        {{ family.name }}
      </button>
      <span class="flex items-center gap-2 text-[12.5px] text-muted-foreground">
        <span v-if="isNew" class="rounded-full bg-success/15 px-1.5 text-[11px] leading-[18px] font-medium text-success">{{
          t('settings.admin.serverFonts.newBadge')
        }}</span>
        <span class="tabular-nums">{{ fileCountSummary(family.variants) }}</span>
      </span>
      <span v-if="loadFailed" class="mt-0.5 inline-flex items-center gap-1.5 text-[12.5px] text-warning">
        <TriangleAlert :size="13" class="shrink-0" aria-hidden="true" />
        {{ t('settings.admin.serverFonts.loadFailed') }}
      </span>
    </div>

    <p
      class="order-3 col-span-2 min-w-0 overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,black_calc(100%-3.5rem),transparent)] rtl:[mask-image:linear-gradient(to_left,black_calc(100%-3.5rem),transparent)] @min-[60rem]:order-2 @min-[60rem]:col-span-1"
      :class="muted ? 'text-muted-foreground' : 'text-foreground'"
      :style="specimenStyle"
    >
      {{ previewText }}
    </p>

    <div
      class="order-4 col-span-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 @min-[60rem]:order-3 @min-[60rem]:col-span-1 @min-[60rem]:flex-col @min-[60rem]:items-start"
    >
      <FontStyleGrid :fonts="family.variants" :label="summary" />
      <span class="text-[12.5px] text-muted-foreground">{{ summary }}</span>
    </div>

    <div
      class="order-5 col-span-2 flex flex-wrap gap-x-3 gap-y-1 empty:hidden @min-[60rem]:order-4 @min-[60rem]:col-span-1 @min-[60rem]:flex-col @min-[60rem]:empty:flex"
      data-testid="font-family-use"
    >
      <slot name="use" />
    </div>

    <div class="order-2 flex items-center justify-end self-start @min-[60rem]:order-5 @min-[60rem]:self-center" @click.stop>
      <slot name="action" />
    </div>
  </div>
</template>
