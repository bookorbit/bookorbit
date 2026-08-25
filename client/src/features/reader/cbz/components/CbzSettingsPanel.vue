<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  AlignJustify,
  ArrowDownUp,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  BookOpen,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  Maximize,
  RotateCcw,
  ScanLine,
} from '@lucide/vue'
import type { Component } from 'vue'
import { CBX_SPREAD_GAP_MAX, CBX_SPREAD_GAP_MIN, type CbxReaderSettings } from '@bookorbit/types'
import { CBZ_BG_VALUES } from '../composables/useCbzSettings'
import type { BgColor, FitMode } from '../composables/useCbzSettings'
import ReaderRangeField from '@/features/reader/shared/components/ReaderRangeField.vue'
import ReaderSegmentedControl from '@/features/reader/shared/components/ReaderSegmentedControl.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'

const { t } = useI18n()

const props = defineProps<{
  settings: CbxReaderSettings
  canReset?: boolean
  /** Whether spreads are actually rendering; false means the viewport fell back to single pages. */
  isSpreadActive?: boolean
}>()

const emit = defineEmits<{
  update: [partial: Partial<CbxReaderSettings>]
  reset: []
}>()

const contentRef = ref<HTMLElement | null>(null)
const isScrolled = ref(false)

const forceTwoPageLabelId = `cbz-force-two-page-${useId()}`
const autoAdvanceLabelId = `cbz-auto-advance-${useId()}`

function onContentScroll() {
  isScrolled.value = (contentRef.value?.scrollTop ?? 0) > 0
}

const fitOptions = computed<{ value: FitMode; label: string; icon: Component }[]>(() => [
  { value: 'fit-page', label: t('reader.cbz.fit.page'), icon: Maximize },
  { value: 'fit-width', label: t('reader.cbz.fit.width'), icon: ArrowLeftRight },
  { value: 'fit-height', label: t('reader.cbz.fit.height'), icon: ArrowDownUp },
  { value: 'actual', label: t('reader.cbz.fit.actual'), icon: ImageIcon },
])

const viewOptions = computed(() => [
  { value: 'single', label: t('reader.cbz.view.single'), icon: BookOpen },
  { value: 'two-page', label: t('reader.cbz.view.twoPage'), icon: LayoutGrid },
])

const scrollOptions = computed(() => [
  { value: 'paginated', label: t('reader.cbz.scroll.paged'), icon: ScanLine },
  { value: 'infinite', label: t('reader.cbz.scroll.infinite'), icon: Layers },
  { value: 'long-strip', label: t('reader.cbz.scroll.noGaps'), icon: AlignJustify },
])

const directionOptions = computed(() => [
  { value: 'ltr', label: t('reader.cbz.direction.ltr'), icon: ArrowRight },
  { value: 'rtl', label: t('reader.cbz.direction.rtl'), icon: ArrowLeft },
])

const alignmentOptions = computed(() => [
  { value: 'normal', label: t('reader.cbz.spreadAlignment.normal'), icon: LayoutGrid },
  { value: 'shifted', label: t('reader.cbz.spreadAlignment.shifted'), icon: BookOpen },
])

const widePageOptions = computed(() => [
  { value: 'auto', label: t('reader.cbz.widePage.auto'), icon: ImageIcon },
  { value: 'disable', label: t('reader.cbz.widePage.inSpreads'), icon: LayoutGrid },
])

const bgSwatches = computed<{ value: BgColor; label: string; color: string }[]>(() => [
  { value: 'black', label: t('reader.cbz.bg.black'), color: CBZ_BG_VALUES.black },
  { value: 'gray', label: t('reader.cbz.bg.gray'), color: CBZ_BG_VALUES.gray },
  { value: 'white', label: t('reader.cbz.bg.white'), color: CBZ_BG_VALUES.white },
])

const isTwoPagePreferred = computed(() => props.settings.viewMode === 'two-page' && props.settings.scrollMode === 'paginated')
const autoAdvanceHint = computed(() =>
  props.settings.autoAdvance && props.settings.scrollMode !== 'paginated' ? t('reader.cbz.autoAdvancePagedOnly') : t('reader.cbz.autoAdvanceHint'),
)
const showPagedOnlyHint = computed(() => props.settings.viewMode === 'two-page' && props.settings.scrollMode !== 'paginated')

function selectFit(value: FitMode) {
  emit('update', { fitMode: value })
}

function setViewMode(value: string) {
  emit('update', { viewMode: value as CbxReaderSettings['viewMode'] })
}

function setScrollMode(value: string) {
  emit('update', { scrollMode: value as CbxReaderSettings['scrollMode'] })
}

function setDirection(value: string) {
  emit('update', { direction: value as CbxReaderSettings['direction'] })
}

function setSpreadAlignment(value: string) {
  emit('update', { spreadAlignment: value as CbxReaderSettings['spreadAlignment'] })
}

function setWidePageMode(value: string) {
  emit('update', { widePageSingletonMode: value as CbxReaderSettings['widePageSingletonMode'] })
}

function setSpreadGap(value: number) {
  emit('update', { spreadGap: Math.round(value) })
}

function setForceTwoPage(value: boolean) {
  emit('update', { forceTwoPage: value })
}

function setAutoAdvance(value: boolean) {
  emit('update', { autoAdvance: value })
}

function selectBackground(value: BgColor) {
  emit('update', { bgColor: value })
}

function requestReset() {
  emit('reset')
}

const groupLabelClass = 'mb-2 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'
</script>

<template>
  <section class="flex min-h-0 flex-col overflow-hidden bg-card text-card-foreground">
    <div class="flex shrink-0 items-center gap-2 border-b border-border bg-card px-4 py-2.5 transition-shadow" :class="isScrolled ? 'shadow-sm' : ''">
      <h2 class="mr-auto text-sm font-semibold">{{ t('reader.settings.title') }}</h2>
      <button
        type="button"
        class="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
        :disabled="!canReset"
        :title="t('reader.settings.reset')"
        :aria-label="t('reader.settings.reset')"
        @click="requestReset"
      >
        <RotateCcw :size="15" />
      </button>
    </div>

    <div ref="contentRef" class="min-h-0 flex-1 overflow-y-auto" @scroll="onContentScroll">
      <div class="border-b border-border px-4 py-3.5">
        <p :class="groupLabelClass">{{ t('reader.cbz.fitMode') }}</p>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="option in fitOptions"
            :key="option.value"
            type="button"
            class="flex h-10 min-w-0 items-center justify-center gap-1.5 truncate rounded-lg border px-2 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55 focus-visible:ring-offset-1 focus-visible:ring-offset-card"
            :class="
              settings.fitMode === option.value
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-foreground hover:border-muted-foreground/40 hover:bg-muted'
            "
            :aria-pressed="settings.fitMode === option.value"
            @click="selectFit(option.value)"
          >
            <component :is="option.icon" :size="14" class="shrink-0" />
            <span class="truncate">{{ option.label }}</span>
          </button>
        </div>
      </div>

      <div class="border-b border-border px-4 py-3.5">
        <p :class="groupLabelClass">{{ t('reader.cbz.pageView') }}</p>
        <ReaderSegmentedControl
          :options="viewOptions"
          :model-value="settings.viewMode"
          :aria-label="t('reader.cbz.pageView')"
          @update:model-value="setViewMode"
        />
        <p v-if="showPagedOnlyHint" class="mt-2 text-xs leading-snug text-muted-foreground">{{ t('reader.cbz.twoPagePagedOnly') }}</p>
      </div>

      <div v-if="isTwoPagePreferred" class="border-b border-border px-4 py-3.5">
        <p :class="groupLabelClass">{{ t('reader.cbz.spreadSection') }}</p>
        <div class="space-y-4">
          <p v-if="!isSpreadActive" class="text-xs leading-snug text-muted-foreground">{{ t('reader.cbz.spreadFallbackHint') }}</p>

          <div class="flex items-center justify-between gap-3">
            <span :id="forceTwoPageLabelId" class="text-[13px] font-medium text-foreground">{{ t('reader.cbz.forceTwoPage') }}</span>
            <ToggleSwitch :model-value="settings.forceTwoPage" :aria-labelledby="forceTwoPageLabelId" @update:model-value="setForceTwoPage" />
          </div>

          <div>
            <p :class="groupLabelClass">{{ t('reader.cbz.spreadAlignmentLabel') }}</p>
            <ReaderSegmentedControl
              :options="alignmentOptions"
              :model-value="settings.spreadAlignment"
              :aria-label="t('reader.cbz.spreadAlignmentLabel')"
              @update:model-value="setSpreadAlignment"
            />
          </div>

          <div>
            <p :class="groupLabelClass">{{ t('reader.cbz.widePages') }}</p>
            <ReaderSegmentedControl
              :options="widePageOptions"
              :model-value="settings.widePageSingletonMode"
              :aria-label="t('reader.cbz.widePages')"
              @update:model-value="setWidePageMode"
            />
          </div>

          <ReaderRangeField
            :model-value="settings.spreadGap"
            :min="CBX_SPREAD_GAP_MIN"
            :max="CBX_SPREAD_GAP_MAX"
            :step="1"
            :label="t('reader.cbz.spreadGap')"
            :display-value="t('reader.cbz.spreadGapValue', { value: settings.spreadGap })"
            @update:model-value="setSpreadGap"
          />
        </div>
      </div>

      <div class="border-b border-border px-4 py-3.5">
        <p :class="groupLabelClass">{{ t('reader.cbz.scrollMode') }}</p>
        <ReaderSegmentedControl
          :options="scrollOptions"
          :model-value="settings.scrollMode"
          :aria-label="t('reader.cbz.scrollMode')"
          @update:model-value="setScrollMode"
        />
        <p class="mt-2 text-xs leading-snug text-muted-foreground">{{ t('reader.cbz.scrollModeHint') }}</p>
      </div>

      <div class="border-b border-border px-4 py-3.5">
        <p :class="groupLabelClass">{{ t('reader.cbz.readingDirection') }}</p>
        <ReaderSegmentedControl
          :options="directionOptions"
          :model-value="settings.direction"
          :aria-label="t('reader.cbz.readingDirection')"
          @update:model-value="setDirection"
        />
      </div>

      <div class="border-b border-border px-4 py-3.5">
        <div class="flex items-center justify-between gap-3">
          <span :id="autoAdvanceLabelId" class="text-[13px] font-medium text-foreground">{{ t('reader.cbz.autoAdvance') }}</span>
          <ToggleSwitch :model-value="settings.autoAdvance" :aria-labelledby="autoAdvanceLabelId" @update:model-value="setAutoAdvance" />
        </div>
        <p class="mt-2 text-xs leading-snug text-muted-foreground">
          {{ autoAdvanceHint }}
        </p>
      </div>

      <div class="px-4 py-3.5">
        <p :class="groupLabelClass">{{ t('reader.cbz.background') }}</p>
        <div class="grid grid-cols-3 gap-x-2 gap-y-1.5">
          <button
            v-for="swatch in bgSwatches"
            :key="swatch.value"
            type="button"
            class="group rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55 focus-visible:ring-offset-1 focus-visible:ring-offset-card"
            :aria-pressed="settings.bgColor === swatch.value"
            :aria-label="swatch.label"
            @click="selectBackground(swatch.value)"
          >
            <span
              aria-hidden="true"
              class="block h-9 w-full rounded-md border border-border/60 ring-2 ring-offset-2 ring-offset-card transition-all"
              :class="settings.bgColor === swatch.value ? 'ring-primary' : 'ring-transparent group-hover:ring-border'"
              :style="{ background: swatch.color }"
            />
            <span
              class="mt-0.5 block truncate text-center text-[10px] leading-tight"
              :class="settings.bgColor === swatch.value ? 'text-foreground' : 'text-muted-foreground'"
            >
              {{ swatch.label }}
            </span>
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
