<script setup lang="ts">
import { computed, onUnmounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { EPUB_FONT_SIZE_MAX, EPUB_FONT_SIZE_MIN } from '@bookorbit/types'
import {
  BookOpen,
  ChevronDown,
  LayoutGrid,
  Moon,
  RectangleHorizontal,
  RectangleVertical,
  RotateCcw,
  Rows2,
  Rows4,
  ScrollText,
  Sun,
} from '@lucide/vue'
import type { ReaderState } from '../composables/useReaderState'
import type { FontFamily, useCustomFonts } from '../composables/useCustomFonts'
import { themes } from '../constants/themes'
import { BUILTIN_READER_FONT_OPTIONS, type ReaderBuiltInFontOption } from '@/features/reader/shared/constants/font-options'
import { formatFontFamilyLabel } from '@/features/reader/shared/lib/font-display'
import ReaderRangeField from '@/features/reader/shared/components/ReaderRangeField.vue'
import ReaderSegmentedControl from '@/features/reader/shared/components/ReaderSegmentedControl.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'

const { t } = useI18n()

const props = defineProps<{
  state: ReaderState
  customFonts?: ReturnType<typeof useCustomFonts>
  isFixedLayout?: boolean
  canReset?: boolean
}>()

const emit = defineEmits<{
  update: [partial: Partial<ReaderState>]
  reset: []
}>()

const COLUMN_MIN = 1
const COLUMN_MAX = 10

const contentRef = ref<HTMLElement | null>(null)
const isScrolled = ref(false)

const justifyLabelId = `reader-justify-${useId()}`
const hyphenationLabelId = `reader-hyphenation-${useId()}`

function onContentScroll() {
  isScrolled.value = (contentRef.value?.scrollTop ?? 0) > 0
}

const modeOptions = computed(() => [
  { value: 'light', label: t('reader.settings.mode.light'), icon: Sun },
  { value: 'dark', label: t('reader.settings.mode.dark'), icon: Moon },
])

const flowOptions = computed(() => [
  { value: 'paginated', label: t('reader.settings.flow.paginated'), icon: BookOpen },
  { value: 'scrolled', label: t('reader.settings.flow.scrolled'), icon: ScrollText },
])

const spreadOptions = computed(() => [
  { value: 'auto', label: t('reader.settings.spread.bookDefault'), icon: LayoutGrid },
  { value: 'none', label: t('reader.settings.spread.singlePage'), icon: BookOpen },
])

const currentMode = computed(() => (props.state.isDark ? 'dark' : 'light'))

/**
 * Page width reads as a word rather than a pixel count: readers are choosing how wide
 * the text column feels, and 400-1600 means nothing without seeing the result.
 */
const pageWidthLabel = computed(() => {
  const width = props.state.maxInlineSize
  if (width <= 640) return t('reader.settings.pageWidthNarrow')
  if (width <= 1000) return t('reader.settings.pageWidthMedium')
  if (width <= 1320) return t('reader.settings.pageWidthWide')
  return t('reader.settings.pageWidthFull')
})

const columnGapPercent = computed(() => Math.round(props.state.gap * 100))

function setMode(value: string) {
  emit('update', { isDark: value === 'dark' })
}

function selectTheme(themeName: string) {
  emit('update', { themeName })
}

function decreaseTextSize() {
  emit('update', { fontSize: Math.max(EPUB_FONT_SIZE_MIN, props.state.fontSize - 1) })
}

function increaseTextSize() {
  emit('update', { fontSize: Math.min(EPUB_FONT_SIZE_MAX, props.state.fontSize + 1) })
}

function selectBuiltInFont(font: ReaderBuiltInFontOption) {
  emit('update', { fontFamily: font.value })
}

function setLineHeight(value: number) {
  emit('update', { lineHeight: Math.round(value * 10) / 10 })
}

function setPageWidth(value: number) {
  emit('update', { maxInlineSize: value })
}

function setFlow(value: string) {
  emit('update', { flow: value as ReaderState['flow'] })
}

function setFixedLayoutSpread(value: string) {
  emit('update', { fixedLayoutSpread: value as ReaderState['fixedLayoutSpread'] })
}

function decreaseColumns() {
  emit('update', { maxColumnCount: Math.max(COLUMN_MIN, props.state.maxColumnCount - 1) })
}

function increaseColumns() {
  emit('update', { maxColumnCount: Math.min(COLUMN_MAX, props.state.maxColumnCount + 1) })
}

function setColumnGap(value: number) {
  emit('update', { gap: Math.round(value) / 100 })
}

function setJustify(value: boolean) {
  emit('update', { justify: value })
}

function setHyphenate(value: boolean) {
  emit('update', { hyphenate: value })
}

function requestReset() {
  emit('reset')
}

const previewStyleEl = ref<HTMLStyleElement | null>(null)

function removePreviewStyles() {
  previewStyleEl.value?.remove()
  previewStyleEl.value = null
}

/** Lets each custom-font button render in its own typeface, which is the whole point of the preview. */
function injectPreviewStyles(css: string) {
  removePreviewStyles()
  if (!css) return
  const el = document.createElement('style')
  el.setAttribute('data-reader-font-preview', '')
  el.textContent = css
  document.head.appendChild(el)
  previewStyleEl.value = el
}

watch(
  () => [props.customFonts?.fonts.value, props.customFonts?.serverFonts.value],
  () => {
    injectPreviewStyles(props.customFonts?.generateFontFaceCSS() ?? '')
  },
  { immediate: true },
)

onUnmounted(removePreviewStyles)

/** Server fonts first: they are the curated set an administrator chose for everyone. */
const customFontSections = computed(() => {
  const customFonts = props.customFonts
  if (!customFonts) return []
  return [
    { key: 'server', label: t('reader.settings.fontServer'), families: customFonts.visibleServerFamilies.value },
    { key: 'user', label: t('reader.settings.fontYours'), families: customFonts.families.value },
  ].filter((section) => section.families.length > 0)
})

const hasCustomFontSections = computed(() => customFontSections.value.length > 0)

function selectCustomFont(family: FontFamily) {
  const cssFamilyName = props.customFonts?.getCssFamilyForDisplay(family.name, family.scope)
  if (cssFamilyName) emit('update', { fontFamily: cssFamilyName })
}

function isCustomFontSelected(family: FontFamily): boolean {
  if (!props.customFonts) return false
  return props.customFonts.isFontFamilySelected(family.name, props.state.fontFamily, family.scope)
}

const groupLabelClass = 'mb-2 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'
const stepperButtonClass =
  'flex h-10 flex-1 items-center justify-center rounded-lg border border-border font-serif text-foreground transition-colors hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent'
const cardBaseClass =
  'group rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55 focus-visible:ring-offset-1 focus-visible:ring-offset-card'
</script>

<template>
  <section class="flex min-h-0 flex-col overflow-hidden bg-card text-card-foreground">
    <div class="flex shrink-0 items-center gap-2 border-b border-border bg-card px-4 py-2.5 transition-shadow" :class="isScrolled ? 'shadow-sm' : ''">
      <h2 class="mr-auto text-sm font-semibold">{{ t('reader.settings.title') }}</h2>
      <ReaderSegmentedControl
        class="w-[9.75rem] shrink-0"
        :options="modeOptions"
        :model-value="currentMode"
        :aria-label="t('reader.settings.modeLabel')"
        @update:model-value="setMode"
      />
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
      <div v-if="!isFixedLayout" class="border-b border-border px-4 py-3.5">
        <p :class="groupLabelClass">{{ t('reader.settings.textSize') }}</p>
        <div class="flex items-center gap-2">
          <button
            type="button"
            :class="stepperButtonClass"
            class="text-sm"
            :disabled="state.fontSize <= EPUB_FONT_SIZE_MIN"
            :aria-label="t('reader.settings.textSizeSmaller')"
            @click="decreaseTextSize"
          >
            A
          </button>
          <span class="w-16 shrink-0 rounded-lg bg-muted py-2 text-center text-[13px] font-semibold tabular-nums text-foreground">
            {{ t('reader.settings.pixels', { value: state.fontSize }) }}
          </span>
          <button
            type="button"
            :class="stepperButtonClass"
            class="text-xl"
            :disabled="state.fontSize >= EPUB_FONT_SIZE_MAX"
            :aria-label="t('reader.settings.textSizeLarger')"
            @click="increaseTextSize"
          >
            A
          </button>
        </div>
      </div>

      <div class="border-b border-border px-4 py-3.5">
        <p :class="groupLabelClass">{{ t('reader.settings.pageColor') }}</p>
        <div class="grid grid-cols-4 gap-x-2 gap-y-1.5">
          <button
            v-for="theme in themes"
            :key="theme.name"
            type="button"
            :class="cardBaseClass"
            :aria-pressed="state.themeName === theme.name"
            :aria-label="t(theme.labelKey)"
            @click="selectTheme(theme.name)"
          >
            <span
              aria-hidden="true"
              class="relative flex h-9 w-full items-center justify-center overflow-hidden rounded-md font-serif text-[13px] ring-2 ring-offset-2 ring-offset-card transition-all"
              :class="state.themeName === theme.name ? 'ring-primary' : 'ring-transparent group-hover:ring-border'"
              :style="{ background: state.isDark ? theme.dark.bg : theme.light.bg, color: state.isDark ? theme.dark.fg : theme.light.fg }"
            >
              <span class="absolute inset-x-0 top-0 h-[3px]" :style="{ background: state.isDark ? theme.dark.link : theme.light.link }" />
              Aa
            </span>
            <span
              class="mt-0.5 block truncate text-center text-[10px] leading-tight"
              :class="state.themeName === theme.name ? 'text-foreground' : 'text-muted-foreground'"
            >
              {{ t(theme.labelKey) }}
            </span>
          </button>
        </div>
      </div>

      <template v-if="!isFixedLayout">
        <div class="border-b border-border px-4 py-3.5">
          <p :class="groupLabelClass">{{ t('reader.settings.font') }}</p>
          <p v-if="hasCustomFontSections" class="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {{ t('reader.settings.fontBuiltIn') }}
          </p>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="font in BUILTIN_READER_FONT_OPTIONS"
              :key="String(font.value)"
              type="button"
              class="h-10 truncate rounded-lg border px-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55 focus-visible:ring-offset-1 focus-visible:ring-offset-card"
              :class="
                state.fontFamily === font.value
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-foreground hover:border-muted-foreground/40 hover:bg-muted'
              "
              :style="font.value ? { fontFamily: font.value } : {}"
              :aria-pressed="state.fontFamily === font.value"
              @click="selectBuiltInFont(font)"
            >
              {{ t(font.labelKey) }}
            </button>
          </div>

          <template v-for="section in customFontSections" :key="section.key">
            <p class="mb-1.5 mt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{{ section.label }}</p>
            <div class="grid grid-cols-2 gap-2">
              <button
                v-for="family in section.families"
                :key="family.cssFamilyName"
                type="button"
                class="h-10 truncate rounded-lg border px-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55 focus-visible:ring-offset-1 focus-visible:ring-offset-card"
                :class="
                  isCustomFontSelected(family)
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-foreground hover:border-muted-foreground/40 hover:bg-muted'
                "
                :style="{ fontFamily: `'${family.cssFamilyName}', sans-serif` }"
                :aria-pressed="isCustomFontSelected(family)"
                @click="selectCustomFont(family)"
              >
                {{ formatFontFamilyLabel(family.name) }}
              </button>
            </div>
          </template>
        </div>

        <div class="border-b border-border px-4 py-3.5">
          <ReaderRangeField
            :model-value="state.lineHeight"
            :min="0.8"
            :max="3"
            :step="0.1"
            :label="t('reader.settings.lineSpacing')"
            :display-value="state.lineHeight.toFixed(1)"
            :min-icon="Rows4"
            :max-icon="Rows2"
            @update:model-value="setLineHeight"
          />
        </div>

        <div class="border-b border-border px-4 py-3.5">
          <ReaderRangeField
            :model-value="state.maxInlineSize"
            :min="400"
            :max="1600"
            :step="40"
            :label="t('reader.settings.pageWidth')"
            :display-value="pageWidthLabel"
            :min-icon="RectangleVertical"
            :max-icon="RectangleHorizontal"
            @update:model-value="setPageWidth"
          />
        </div>

        <div class="border-b border-border px-4 py-3.5">
          <p :class="groupLabelClass">{{ t('reader.settings.readingFlow') }}</p>
          <ReaderSegmentedControl
            :options="flowOptions"
            :model-value="state.flow"
            :aria-label="t('reader.settings.readingFlow')"
            @update:model-value="setFlow"
          />
        </div>

        <details class="group/adv">
          <summary
            class="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/55 [&::-webkit-details-marker]:hidden"
          >
            {{ t('reader.settings.advanced') }}
            <ChevronDown :size="14" class="ml-auto transition-transform group-open/adv:rotate-180" />
          </summary>

          <div class="space-y-4 px-4 pb-4">
            <div class="flex items-center justify-between gap-3">
              <span class="text-[13px] font-medium text-foreground">{{ t('reader.settings.columns') }}</span>
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  class="flex size-8 items-center justify-center rounded-lg border border-border text-lg font-light text-foreground transition-colors hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
                  :disabled="state.maxColumnCount <= COLUMN_MIN"
                  :aria-label="t('reader.settings.columnsFewer')"
                  @click="decreaseColumns"
                >
                  &minus;
                </button>
                <span class="w-6 text-center text-[13px] font-semibold tabular-nums text-foreground">{{ state.maxColumnCount }}</span>
                <button
                  type="button"
                  class="flex size-8 items-center justify-center rounded-lg border border-border text-lg font-light text-foreground transition-colors hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
                  :disabled="state.maxColumnCount >= COLUMN_MAX"
                  :aria-label="t('reader.settings.columnsMore')"
                  @click="increaseColumns"
                >
                  +
                </button>
              </div>
            </div>

            <ReaderRangeField
              :model-value="columnGapPercent"
              :min="0"
              :max="50"
              :step="1"
              :label="t('reader.settings.columnGap')"
              :display-value="t('reader.settings.percent', { value: columnGapPercent })"
              @update:model-value="setColumnGap"
            />

            <div class="flex items-center justify-between gap-3">
              <span :id="justifyLabelId" class="text-[13px] font-medium text-foreground">{{ t('reader.settings.justifyText') }}</span>
              <ToggleSwitch :model-value="state.justify" :aria-labelledby="justifyLabelId" @update:model-value="setJustify" />
            </div>

            <div class="flex items-center justify-between gap-3">
              <span :id="hyphenationLabelId" class="text-[13px] font-medium text-foreground">{{ t('reader.settings.hyphenation') }}</span>
              <ToggleSwitch :model-value="state.hyphenate" :aria-labelledby="hyphenationLabelId" @update:model-value="setHyphenate" />
            </div>
          </div>
        </details>
      </template>

      <div v-else class="px-4 py-3.5">
        <p :class="groupLabelClass">{{ t('reader.settings.pageSpreads') }}</p>
        <ReaderSegmentedControl
          :options="spreadOptions"
          :model-value="state.fixedLayoutSpread ?? 'auto'"
          :aria-label="t('reader.settings.pageSpreads')"
          @update:model-value="setFixedLayoutSpread"
        />
        <p class="mt-2 text-xs leading-snug text-muted-foreground">{{ t('reader.settings.pageSpreadsHint') }}</p>
      </div>
    </div>
  </section>
</template>
