<script setup lang="ts">
import { computed, onUnmounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  EPUB_FONT_SIZE_MAX,
  EPUB_FONT_SIZE_MIN,
  EPUB_LETTER_SPACING_MAX,
  EPUB_LETTER_SPACING_MIN,
  EPUB_PARAGRAPH_SPACING_MAX,
  EPUB_PARAGRAPH_SPACING_MIN,
  EPUB_TEXT_INDENT_MAX,
  EPUB_TEXT_INDENT_MIN,
  EPUB_WORD_SPACING_MAX,
  EPUB_WORD_SPACING_MIN,
  isCustomFontCssFamily,
  type FontNamedInstance,
  type FontVariant,
} from '@bookorbit/types'
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
import { formatNumber } from '@/i18n/formatters'
import { FONT_WEIGHT_LABEL_KEYS, builtInVariants, closestVariant, familyVariants, isSameVariant } from '@/features/reader/shared/lib/font-variants'
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

const fontStyleLabelId = `reader-font-style-${useId()}`
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
  {
    value: 'paginated',
    label: t('reader.settings.flow.paginated'),
    icon: BookOpen,
  },
  {
    value: 'scrolled',
    label: t('reader.settings.flow.scrolled'),
    icon: ScrollText,
  },
])

const spreadOptions = computed(() => [
  {
    value: 'auto',
    label: t('reader.settings.spread.bookDefault'),
    icon: LayoutGrid,
  },
  {
    value: 'none',
    label: t('reader.settings.spread.singlePage'),
    icon: BookOpen,
  },
])

const typographySourceOptions = computed(() => [
  { value: 'book', label: t('reader.settings.bookDefault') },
  { value: 'custom', label: t('reader.settings.custom') },
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

const paragraphSpacingLabel = computed(() =>
  props.state.paragraphSpacing === EPUB_PARAGRAPH_SPACING_MIN
    ? t('reader.settings.paragraphSpacingDefault')
    : t('reader.settings.paragraphSpacingValue', {
        value: formatNumber(props.state.paragraphSpacing, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }),
      }),
)
const letterSpacingSource = computed(() => (props.state.letterSpacing === null ? 'book' : 'custom'))
const wordSpacingSource = computed(() => (props.state.wordSpacing === null ? 'book' : 'custom'))
const textIndentSource = computed(() => (props.state.textIndent === null ? 'book' : 'custom'))
const letterSpacingValue = computed(() => props.state.letterSpacing ?? EPUB_LETTER_SPACING_MIN)
const wordSpacingValue = computed(() => props.state.wordSpacing ?? EPUB_WORD_SPACING_MIN)
const textIndentValue = computed(() => props.state.textIndent ?? EPUB_TEXT_INDENT_MIN)
const letterSpacingLabel = computed(() => formatEmValue(letterSpacingValue.value, 2))
const wordSpacingLabel = computed(() => formatEmValue(wordSpacingValue.value, 2))
const textIndentLabel = computed(() => formatEmValue(textIndentValue.value, 2))

const columnGapPercent = computed(() => Math.round(props.state.gap * 100))

function setMode(value: string) {
  emit('update', { isDark: value === 'dark' })
}

function selectTheme(themeName: string) {
  emit('update', { themeName })
}

function decreaseTextSize() {
  emit('update', {
    fontSize: Math.max(EPUB_FONT_SIZE_MIN, props.state.fontSize - 1),
  })
}

function increaseTextSize() {
  emit('update', {
    fontSize: Math.min(EPUB_FONT_SIZE_MAX, props.state.fontSize + 1),
  })
}

function selectBuiltInFont(font: ReaderBuiltInFontOption) {
  emit('update', {
    fontFamily: font.value,
    ...variantUpdateFor(builtInVariants()),
  })
}

function setLineHeight(value: number) {
  emit('update', { lineHeight: Math.round(value * 10) / 10 })
}

function setParagraphSpacing(value: number) {
  emit('update', { paragraphSpacing: Math.round(value * 10) / 10 })
}

function formatEmValue(value: number, maximumFractionDigits: number): string {
  return t('reader.settings.emValue', {
    value: formatNumber(value, {
      minimumFractionDigits: 0,
      maximumFractionDigits,
    }),
  })
}

function setLetterSpacingSource(value: string) {
  emit('update', {
    letterSpacing: value === 'book' ? null : (props.state.letterSpacing ?? 0),
  })
}

function setWordSpacingSource(value: string) {
  emit('update', {
    wordSpacing: value === 'book' ? null : (props.state.wordSpacing ?? 0),
  })
}

function setTextIndentSource(value: string) {
  emit('update', {
    textIndent: value === 'book' ? null : (props.state.textIndent ?? 0),
  })
}

function setLetterSpacing(value: number) {
  emit('update', { letterSpacing: Math.round(value * 100) / 100 })
}

function setWordSpacing(value: number) {
  emit('update', { wordSpacing: Math.round(value * 20) / 20 })
}

function setTextIndent(value: number) {
  emit('update', { textIndent: Math.round(value * 4) / 4 })
}

function setPageWidth(value: number) {
  emit('update', { maxInlineSize: value })
}

function setFlow(value: string) {
  emit('update', { flow: value as ReaderState['flow'] })
}

function setFixedLayoutSpread(value: string) {
  emit('update', {
    fixedLayoutSpread: value as ReaderState['fixedLayoutSpread'],
  })
}

function decreaseColumns() {
  emit('update', {
    maxColumnCount: Math.max(COLUMN_MIN, props.state.maxColumnCount - 1),
  })
}

function increaseColumns() {
  emit('update', {
    maxColumnCount: Math.min(COLUMN_MAX, props.state.maxColumnCount + 1),
  })
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
    {
      key: 'server',
      label: t('reader.settings.fontServer'),
      families: customFonts.visibleServerFamilies.value,
    },
    {
      key: 'user',
      label: t('reader.settings.fontYours'),
      families: customFonts.families.value,
    },
  ].filter((section) => section.families.length > 0)
})

const hasCustomFontSections = computed(() => customFontSections.value.length > 0)

function selectCustomFont(family: FontFamily) {
  const cssFamilyName = props.customFonts?.getCssFamilyForDisplay(family.name, family.scope)
  if (cssFamilyName)
    emit('update', {
      fontFamily: cssFamilyName,
      ...variantUpdateFor(familyVariants(family.variants)),
    })
}

function isCustomFontSelected(family: FontFamily): boolean {
  if (!props.customFonts) return false
  return props.customFonts.isFontFamilySelected(family.name, props.state.fontFamily, family.scope)
}

const currentVariant = computed<FontVariant>(() => ({
  weight: props.state.fontWeight,
  style: props.state.fontStyle,
}))

/**
 * The styles the selected family offers. Built-in stacks have no file list to read, so
 * they fall back to the four a system font can always produce.
 */
const availableVariants = computed<FontNamedInstance[]>(() => {
  const customFonts = props.customFonts
  const selected = props.state.fontFamily
  if (!customFonts || !isCustomFontCssFamily(selected)) return builtInVariants()

  const family = [...customFonts.visibleServerFamilies.value, ...customFonts.families.value].find((candidate) => candidate.cssFamilyName === selected)
  return family ? familyVariants(family.variants) : builtInVariants()
})

/** A single style is not a choice, so the row only appears once there is one to make. */
const showVariantPicker = computed(() => availableVariants.value.length > 1)

/** Renders each chip in the face it selects. Generic keywords must stay unquoted. */
const variantPreviewFamily = computed(() => {
  const selected = props.state.fontFamily
  if (!selected) return undefined
  return isCustomFontCssFamily(selected) ? `'${selected}', sans-serif` : selected
})

function isVariantSelected(variant: FontVariant): boolean {
  return isSameVariant(variant, currentVariant.value)
}

function selectVariant(variant: FontVariant) {
  emit('update', { fontWeight: variant.weight, fontStyle: variant.style })
}

/**
 * Keeps the chosen style reachable when the family changes. A family that lacks the
 * current style would otherwise leave the row with nothing selected, so the nearest
 * style it does offer takes over.
 */
function variantUpdateFor(variants: FontVariant[]): Partial<ReaderState> {
  if (variants.some((variant) => isSameVariant(variant, currentVariant.value))) return {}

  const fallback = closestVariant(variants, currentVariant.value)
  return fallback ? { fontWeight: fallback.weight, fontStyle: fallback.style } : {}
}

function variantLabel(variant: FontNamedInstance): string {
  const weightKey = FONT_WEIGHT_LABEL_KEYS[variant.weight]
  const base = variant.name ?? (weightKey ? t(weightKey) : String(variant.weight))
  // A designer's own name usually says so already; only spell it out when it does not.
  if (variant.style !== 'italic' || /italic|oblique/i.test(base)) return base
  return t('reader.settings.fontStyleItalicOf', { style: base })
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
      <h2 class="mr-auto text-sm font-semibold">
        {{ t('reader.settings.title') }}
      </h2>
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
              :style="{
                background: state.isDark ? theme.dark.bg : theme.light.bg,
                color: state.isDark ? theme.dark.fg : theme.light.fg,
              }"
            >
              <span
                class="absolute inset-x-0 top-0 h-[3px]"
                :style="{
                  background: state.isDark ? theme.dark.link : theme.light.link,
                }"
              />
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
            <p class="mb-1.5 mt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {{ section.label }}
            </p>
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

          <template v-if="showVariantPicker">
            <p :id="fontStyleLabelId" class="mb-1.5 mt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {{ t('reader.settings.fontStyle') }}
            </p>
            <div class="flex flex-wrap gap-2" role="group" :aria-labelledby="fontStyleLabelId">
              <button
                v-for="variant in availableVariants"
                :key="`${variant.weight}:${variant.style}`"
                type="button"
                class="h-9 rounded-lg border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55 focus-visible:ring-offset-1 focus-visible:ring-offset-card"
                :class="
                  isVariantSelected(variant)
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-foreground hover:border-muted-foreground/40 hover:bg-muted'
                "
                :style="{
                  fontFamily: variantPreviewFamily,
                  fontWeight: variant.weight,
                  fontStyle: variant.style,
                }"
                :aria-pressed="isVariantSelected(variant)"
                @click="selectVariant(variant)"
              >
                {{ variantLabel(variant) }}
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
            :model-value="state.paragraphSpacing"
            :min="EPUB_PARAGRAPH_SPACING_MIN"
            :max="EPUB_PARAGRAPH_SPACING_MAX"
            :step="0.1"
            :label="t('reader.settings.paragraphSpacing')"
            :display-value="paragraphSpacingLabel"
            :min-icon="Rows4"
            :max-icon="Rows2"
            @update:model-value="setParagraphSpacing"
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

            <div class="space-y-2">
              <p class="text-[13px] font-medium text-foreground">
                {{ t('reader.settings.letterSpacing') }}
              </p>
              <ReaderSegmentedControl
                :options="typographySourceOptions"
                :model-value="letterSpacingSource"
                :aria-label="t('reader.settings.letterSpacing')"
                @update:model-value="setLetterSpacingSource"
              />
              <ReaderRangeField
                v-if="state.letterSpacing !== null"
                :model-value="letterSpacingValue"
                :min="EPUB_LETTER_SPACING_MIN"
                :max="EPUB_LETTER_SPACING_MAX"
                :step="0.01"
                :label="t('reader.settings.letterSpacing')"
                :display-value="letterSpacingLabel"
                @update:model-value="setLetterSpacing"
              />
            </div>

            <div class="space-y-2">
              <p class="text-[13px] font-medium text-foreground">
                {{ t('reader.settings.wordSpacing') }}
              </p>
              <ReaderSegmentedControl
                :options="typographySourceOptions"
                :model-value="wordSpacingSource"
                :aria-label="t('reader.settings.wordSpacing')"
                @update:model-value="setWordSpacingSource"
              />
              <ReaderRangeField
                v-if="state.wordSpacing !== null"
                :model-value="wordSpacingValue"
                :min="EPUB_WORD_SPACING_MIN"
                :max="EPUB_WORD_SPACING_MAX"
                :step="0.05"
                :label="t('reader.settings.wordSpacing')"
                :display-value="wordSpacingLabel"
                @update:model-value="setWordSpacing"
              />
            </div>

            <div class="space-y-2">
              <p class="text-[13px] font-medium text-foreground">
                {{ t('reader.settings.textIndent') }}
              </p>
              <ReaderSegmentedControl
                :options="typographySourceOptions"
                :model-value="textIndentSource"
                :aria-label="t('reader.settings.textIndent')"
                @update:model-value="setTextIndentSource"
              />
              <ReaderRangeField
                v-if="state.textIndent !== null"
                :model-value="textIndentValue"
                :min="EPUB_TEXT_INDENT_MIN"
                :max="EPUB_TEXT_INDENT_MAX"
                :step="0.25"
                :label="t('reader.settings.textIndent')"
                :display-value="textIndentLabel"
                @update:model-value="setTextIndent"
              />
            </div>

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
        <p class="mt-2 text-xs leading-snug text-muted-foreground">
          {{ t('reader.settings.pageSpreadsHint') }}
        </p>
      </div>
    </div>
  </section>
</template>
