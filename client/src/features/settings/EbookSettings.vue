<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  EPUB_LETTER_SPACING_MAX,
  EPUB_LETTER_SPACING_MIN,
  EPUB_PARAGRAPH_SPACING_MAX,
  EPUB_PARAGRAPH_SPACING_MIN,
  EPUB_TEXT_INDENT_MAX,
  EPUB_TEXT_INDENT_MIN,
  EPUB_WORD_SPACING_MAX,
  EPUB_WORD_SPACING_MIN,
  isCustomFontCssFamily,
  type EpubReaderSettings,
  type FontNamedInstance,
} from '@bookorbit/types'
import { useReaderDefaultSettings } from '@/features/reader/shared/composables/useReaderSettings'
import { useCustomFonts } from '@/features/reader/epub/composables/useCustomFonts'
import { themes } from '@/features/reader/epub/constants/themes'
import { BUILTIN_READER_FONT_OPTIONS } from '@/features/reader/shared/constants/font-options'
import { formatFontFamilyLabel } from '@/features/reader/shared/lib/font-display'
import { formatNumber } from '@/i18n/formatters'
import {
  FONT_WEIGHT_LABEL_KEYS,
  builtInVariants,
  closestVariant,
  familyVariants,
  isSameVariant,
  variantKey,
} from '@/features/reader/shared/lib/font-variants'
import { Check } from '@lucide/vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import SettingsPageHeader from './SettingsPageHeader.vue'
import SettingsResetAction from './SettingsResetAction.vue'

const props = withDefaults(
  defineProps<{
    embedded?: boolean
  }>(),
  {
    embedded: false,
  },
)

const { t } = useI18n()
const fontStyleSelectId = `ebook-font-style-${useId()}`
const paragraphSpacingInputId = `ebook-paragraph-spacing-${useId()}`
const letterSpacingSourceId = `ebook-letter-spacing-source-${useId()}`
const letterSpacingInputId = `ebook-letter-spacing-${useId()}`
const wordSpacingSourceId = `ebook-word-spacing-source-${useId()}`
const wordSpacingInputId = `ebook-word-spacing-${useId()}`
const textIndentSourceId = `ebook-text-indent-source-${useId()}`
const textIndentInputId = `ebook-text-indent-${useId()}`

const { effective, load, update, reset } = useReaderDefaultSettings<EpubReaderSettings>('epub')

const customFonts = useCustomFonts()

const customFontOptions = computed(() =>
  customFonts.families.value.map((f) => ({
    id: f.cssFamilyName,
    label: formatFontFamilyLabel(f.name),
  })),
)

const serverFontOptions = computed(() =>
  customFonts.visibleServerFamilies.value.map((f) => ({
    id: f.cssFamilyName,
    label: formatFontFamilyLabel(f.name),
  })),
)

/** The styles a family offers, falling back to the system four for a built-in stack. */
function variantsForFamily(cssFamilyName: string | null): FontNamedInstance[] {
  if (!isCustomFontCssFamily(cssFamilyName)) return builtInVariants()

  const family = [...customFonts.visibleServerFamilies.value, ...customFonts.families.value].find(
    (candidate) => candidate.cssFamilyName === cssFamilyName,
  )
  const variants = familyVariants(family?.variants ?? [])
  return variants.length > 0 ? variants : builtInVariants()
}

const fontStyleOptions = computed(() =>
  variantsForFamily(effective.value.fontFamily).map((variant) => ({
    value: variantKey(variant),
    label: fontStyleLabel(variant),
    variant,
  })),
)

function fontStyleLabel(variant: FontNamedInstance): string {
  const weightKey = FONT_WEIGHT_LABEL_KEYS[variant.weight]
  const base = variant.name ?? (weightKey ? t(weightKey) : String(variant.weight))
  if (variant.style !== 'italic' || /italic|oblique/i.test(base)) return base
  return t('settings.reader.fonts.weightItalicOf', { weight: base })
}

const selectedFontStyle = computed(() =>
  variantKey({
    weight: effective.value.fontWeight,
    style: effective.value.fontStyle,
  }),
)
const paragraphSpacingLabel = computed(() =>
  effective.value.paragraphSpacing === EPUB_PARAGRAPH_SPACING_MIN
    ? t('settings.reader.ebook.paragraphSpacingDefault')
    : t('settings.reader.ebook.paragraphSpacingValue', {
        value: formatNumber(effective.value.paragraphSpacing, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }),
      }),
)
const letterSpacingValue = computed(() => effective.value.letterSpacing ?? EPUB_LETTER_SPACING_MIN)
const wordSpacingValue = computed(() => effective.value.wordSpacing ?? EPUB_WORD_SPACING_MIN)
const textIndentValue = computed(() => effective.value.textIndent ?? EPUB_TEXT_INDENT_MIN)
const letterSpacingLabel = computed(() => formatEmValue(letterSpacingValue.value, 2))
const wordSpacingLabel = computed(() => formatEmValue(wordSpacingValue.value, 2))
const textIndentLabel = computed(() => formatEmValue(textIndentValue.value, 2))

function selectFontStyle(event: Event) {
  const chosen = fontStyleOptions.value.find((option) => option.value === (event.target as HTMLSelectElement).value)
  if (chosen)
    update({
      fontWeight: chosen.variant.weight,
      fontStyle: chosen.variant.style,
    })
}

function setParagraphSpacing(event: Event) {
  update({
    paragraphSpacing: Number((event.target as HTMLInputElement).value),
  })
}

function formatEmValue(value: number, maximumFractionDigits: number): string {
  return t('settings.reader.ebook.emValue', {
    value: formatNumber(value, {
      minimumFractionDigits: 0,
      maximumFractionDigits,
    }),
  })
}

function setLetterSpacingSource(event: Event) {
  const source = (event.target as HTMLSelectElement).value
  update({
    letterSpacing: source === 'book' ? null : (effective.value.letterSpacing ?? 0),
  })
}

function setWordSpacingSource(event: Event) {
  const source = (event.target as HTMLSelectElement).value
  update({
    wordSpacing: source === 'book' ? null : (effective.value.wordSpacing ?? 0),
  })
}

function setTextIndentSource(event: Event) {
  const source = (event.target as HTMLSelectElement).value
  update({
    textIndent: source === 'book' ? null : (effective.value.textIndent ?? 0),
  })
}

function setLetterSpacing(event: Event) {
  update({
    letterSpacing: Math.round(Number((event.target as HTMLInputElement).value) * 100) / 100,
  })
}

function setWordSpacing(event: Event) {
  update({
    wordSpacing: Math.round(Number((event.target as HTMLInputElement).value) * 20) / 20,
  })
}

function setTextIndent(event: Event) {
  update({
    textIndent: Math.round(Number((event.target as HTMLInputElement).value) * 4) / 4,
  })
}

/**
 * Switching family also moves the style when the new family lacks the current one, which
 * would otherwise leave the style select showing a value it cannot offer.
 */
function selectFontFamily(event: Event) {
  const fontFamily = (event.target as HTMLSelectElement).value || null
  const variants = variantsForFamily(fontFamily)
  const current = {
    weight: effective.value.fontWeight,
    style: effective.value.fontStyle,
  }

  if (variants.some((variant) => isSameVariant(variant, current))) {
    update({ fontFamily })
    return
  }

  const fallback = closestVariant(variants, current)
  update(fallback ? { fontFamily, fontWeight: fallback.weight, fontStyle: fallback.style } : { fontFamily })
}

const previewStyleEl = ref<HTMLStyleElement | null>(null)
const fontCatalogLoaded = ref(false)

function injectPreviewStyles(css: string) {
  if (previewStyleEl.value) {
    previewStyleEl.value.textContent = css
    return
  }
  if (!css) return
  const el = document.createElement('style')
  el.setAttribute('data-ebook-settings-font-preview', '')
  el.textContent = css
  document.head.appendChild(el)
  previewStyleEl.value = el
}

function reconcileSavedFont() {
  if (!fontCatalogLoaded.value) return

  const saved = effective.value.fontFamily
  if (isCustomFontCssFamily(saved) && !customFonts.cssFamilyAvailable(saved)) {
    const fallback = closestVariant(builtInVariants(), {
      weight: effective.value.fontWeight,
      style: effective.value.fontStyle,
    })
    update(
      fallback
        ? {
            fontFamily: null,
            fontWeight: fallback.weight,
            fontStyle: fallback.style,
          }
        : { fontFamily: null },
    )
  }
}

watch(
  () => [customFonts.fonts.value, customFonts.serverFonts.value, customFonts.hiddenServerFamilies.value],
  () => {
    injectPreviewStyles(customFonts.generateFontFaceCSS())
    reconcileSavedFont()
  },
  { immediate: true },
)

onMounted(async () => {
  await load()
  await customFonts.fetchAllFonts()
  fontCatalogLoaded.value = true
  reconcileSavedFont()
})

onUnmounted(() => {
  previewStyleEl.value?.remove()
  previewStyleEl.value = null
})

function setFixedLayoutSpreadAuto() {
  update({ fixedLayoutSpread: 'auto' })
}

function setFixedLayoutSpreadNone() {
  update({ fixedLayoutSpread: 'none' })
}
</script>

<template>
  <div
    class="[&_.settings-hint]:overflow-hidden [&_.settings-hint]:text-ellipsis [&_.settings-hint]:whitespace-nowrap md:[&_.settings-hint]:overflow-visible md:[&_.settings-hint]:whitespace-normal"
  >
    <SettingsPageHeader v-if="!props.embedded" :title="t('settings.reader.ebook.title')" :subtitle="t('settings.reader.ebook.subtitle')" />

    <!-- Formatting source -->
    <div class="mb-6">
      <p class="settings-group-label">
        {{ t('settings.reader.ebook.newBooks') }}
      </p>
      <div class="border border-border rounded-lg overflow-hidden bg-card">
        <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between px-4 py-3.5 md:px-5 md:py-4">
          <div>
            <p class="settings-label">
              {{ t('settings.reader.ebook.applySettings') }}
            </p>
            <p class="settings-hint">
              {{ t('settings.reader.ebook.applySettingsHint') }}
            </p>
          </div>
          <ToggleSwitch
            class="self-start md:mt-0.5"
            :model-value="effective.overrideBookFormatting"
            @update:model-value="update({ overrideBookFormatting: $event })"
          />
        </div>
      </div>
    </div>

    <!-- Layout -->
    <div class="mb-6">
      <p class="settings-group-label">
        {{ t('settings.reader.ebook.layout') }}
      </p>
      <div class="settings-card">
        <!-- Flow -->
        <div class="settings-row">
          <div>
            <p class="settings-label">
              {{ t('settings.reader.ebook.readingFlow') }}
            </p>
            <p class="settings-hint">
              {{ t('settings.reader.ebook.readingFlowHint') }}
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-1.5 p-1 rounded-lg border border-border bg-muted/50 self-start">
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="effective.flow === 'paginated' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ flow: 'paginated' })"
            >
              {{ t('settings.reader.ebook.paginated') }}
            </button>
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="effective.flow === 'scrolled' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ flow: 'scrolled' })"
            >
              {{ t('settings.reader.ebook.scrolled') }}
            </button>
          </div>
        </div>

        <!-- Fixed-layout spread -->
        <div class="settings-row">
          <div>
            <p class="settings-label">
              {{ t('settings.reader.ebook.fixedLayoutSpread') }}
            </p>
            <p class="settings-hint">
              {{ t('settings.reader.ebook.fixedLayoutSpreadHint') }}
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-1.5 p-1 rounded-lg border border-border bg-muted/50 self-start">
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="
                effective.fixedLayoutSpread === 'auto' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'
              "
              @click="setFixedLayoutSpreadAuto"
            >
              {{ t('settings.reader.ebook.bookDefault') }}
            </button>
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="
                effective.fixedLayoutSpread === 'none' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'
              "
              @click="setFixedLayoutSpreadNone"
            >
              {{ t('settings.reader.ebook.singlePage') }}
            </button>
          </div>
        </div>

        <!-- Columns -->
        <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div class="mb-3">
            <div class="flex items-center justify-between gap-3">
              <p class="settings-label">
                {{ t('settings.reader.ebook.columns') }}
              </p>
              <span class="settings-value">{{ effective.maxColumnCount }}</span>
            </div>
            <p class="settings-hint">
              {{ t('settings.reader.ebook.columnsHint') }}
            </p>
          </div>
          <input
            type="range"
            min="1"
            max="4"
            step="1"
            class="w-full accent-primary cursor-pointer"
            :value="effective.maxColumnCount"
            @input="
              update({
                maxColumnCount: Number(($event.target as HTMLInputElement).value),
              })
            "
          />
        </div>
      </div>
    </div>

    <!-- Theme -->
    <div class="mb-6">
      <p class="settings-group-label">{{ t('settings.reader.ebook.theme') }}</p>
      <div class="border border-border rounded-lg overflow-hidden bg-card px-4 py-3.5 md:px-5 md:py-4">
        <!-- Dark mode toggle -->
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">
          <div>
            <p class="settings-label">
              {{ t('settings.reader.ebook.darkMode') }}
            </p>
            <p class="settings-hint">
              {{ t('settings.reader.ebook.darkModeHint') }}
            </p>
          </div>
          <ToggleSwitch class="self-start" :model-value="effective.isDark" @update:model-value="update({ isDark: $event })" />
        </div>
        <!-- Theme swatches -->
        <div class="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-3">
          <button
            v-for="theme in themes"
            :key="theme.name"
            class="flex flex-col items-center gap-1.5 group"
            @click="update({ themeName: theme.name })"
          >
            <div
              class="relative w-full aspect-[4/3] rounded-lg overflow-hidden transition-all ring-2 ring-offset-2 ring-offset-card"
              :class="effective.themeName === theme.name ? 'ring-primary' : 'ring-transparent group-hover:ring-border'"
              :style="{
                background: effective.isDark ? theme.dark.bg : theme.light.bg,
              }"
            >
              <!-- Top accent strip -->
              <div
                class="absolute top-0 left-0 right-0 h-[3px]"
                :style="{
                  background: effective.isDark ? theme.dark.link : theme.light.link,
                }"
              />
              <!-- Title line -->
              <div
                class="absolute top-[10px] left-[8px] right-[12px] h-[3px] rounded-full"
                :style="{
                  background: effective.isDark ? theme.dark.fg : theme.light.fg,
                  opacity: 0.85,
                }"
              />
              <!-- Body text lines -->
              <div
                class="absolute top-[18px] left-[8px] right-[8px] h-[2px] rounded-full"
                :style="{
                  background: effective.isDark ? theme.dark.fg : theme.light.fg,
                  opacity: 0.35,
                }"
              />
              <div
                class="absolute top-[23px] left-[8px] right-[16px] h-[2px] rounded-full"
                :style="{
                  background: effective.isDark ? theme.dark.fg : theme.light.fg,
                  opacity: 0.35,
                }"
              />
              <div
                class="absolute top-[28px] left-[8px] right-[10px] h-[2px] rounded-full"
                :style="{
                  background: effective.isDark ? theme.dark.fg : theme.light.fg,
                  opacity: 0.35,
                }"
              />
              <!-- Link dot -->
              <div
                class="absolute bottom-[7px] left-[8px] h-[2px] w-[14px] rounded-full opacity-80"
                :style="{
                  background: effective.isDark ? theme.dark.link : theme.light.link,
                }"
              />
              <!-- Selected checkmark -->
              <Transition
                enter-active-class="transition-opacity duration-150"
                leave-active-class="transition-opacity duration-150"
                enter-from-class="opacity-0"
                leave-to-class="opacity-0"
              >
                <div
                  v-if="effective.themeName === theme.name"
                  class="absolute bottom-[5px] right-[6px] w-4 h-4 rounded-full bg-primary flex items-center justify-center shadow"
                >
                  <Check :size="9" class="text-primary-foreground" :stroke-width="3" />
                </div>
              </Transition>
            </div>
            <span
              class="text-xs font-medium transition-colors leading-none text-center"
              :class="effective.themeName === theme.name ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'"
            >
              {{ t(theme.labelKey) }}
            </span>
          </button>
        </div>
      </div>
    </div>

    <!-- Typography -->
    <div class="mb-6">
      <p class="settings-group-label">
        {{ t('settings.reader.ebook.typography') }}
      </p>
      <div class="settings-card">
        <!-- Font family -->
        <div class="settings-row">
          <div>
            <p class="settings-label">{{ t('settings.reader.ebook.font') }}</p>
            <p class="settings-hint">
              {{ t('settings.reader.ebook.fontHint') }}
            </p>
          </div>
          <select
            class="text-xs border border-border rounded-md px-2 py-2 md:py-1.5 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary self-start min-w-40"
            :value="effective.fontFamily ?? ''"
            @change="selectFontFamily"
          >
            <optgroup :label="t('settings.reader.ebook.builtInFonts')">
              <option v-for="f in BUILTIN_READER_FONT_OPTIONS" :key="String(f.value)" :value="f.value ?? ''">
                {{ t(f.labelKey) }}
              </option>
            </optgroup>
            <optgroup v-if="serverFontOptions.length > 0" :label="t('reader.settings.fontServer')">
              <option v-for="f in serverFontOptions" :key="f.id" :value="f.id">
                {{ f.label }}
              </option>
            </optgroup>
            <optgroup v-if="customFontOptions.length > 0" :label="t('settings.reader.ebook.yourFonts')">
              <option v-for="f in customFontOptions" :key="f.id" :value="f.id">
                {{ f.label }}
              </option>
            </optgroup>
          </select>
        </div>

        <!-- Font style -->
        <div class="settings-row">
          <div>
            <label :for="fontStyleSelectId" class="settings-label">{{ t('settings.reader.ebook.fontStyle') }}</label>
            <p class="settings-hint">
              {{ t('settings.reader.ebook.fontStyleHint') }}
            </p>
          </div>
          <select
            :id="fontStyleSelectId"
            class="text-xs border border-border rounded-md px-2 py-2 md:py-1.5 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary self-start min-w-40"
            :value="selectedFontStyle"
            @change="selectFontStyle"
          >
            <option v-for="option in fontStyleOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>

        <!-- Font size -->
        <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div class="mb-3">
            <div class="flex items-center justify-between gap-3">
              <p class="settings-label">
                {{ t('settings.reader.ebook.fontSize') }}
              </p>
              <span class="settings-value">{{ effective.fontSize }}px</span>
            </div>
            <p class="settings-hint">
              {{ t('settings.reader.ebook.fontSizeHint') }}
            </p>
          </div>
          <input
            type="range"
            min="10"
            max="32"
            step="1"
            class="w-full accent-primary cursor-pointer"
            :value="effective.fontSize"
            @input="
              update({
                fontSize: Number(($event.target as HTMLInputElement).value),
              })
            "
          />
        </div>

        <!-- Line height -->
        <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div class="mb-3">
            <div class="flex items-center justify-between gap-3">
              <p class="settings-label">
                {{ t('settings.reader.ebook.lineHeight') }}
              </p>
              <span class="settings-value">{{ effective.lineHeight.toFixed(1) }}</span>
            </div>
            <p class="settings-hint">
              {{ t('settings.reader.ebook.lineHeightHint') }}
            </p>
          </div>
          <input
            type="range"
            min="0.8"
            max="3"
            step="0.1"
            class="w-full accent-primary cursor-pointer"
            :value="effective.lineHeight"
            @input="
              update({
                lineHeight: Number(($event.target as HTMLInputElement).value),
              })
            "
          />
        </div>

        <!-- Paragraph spacing -->
        <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div class="mb-3">
            <div class="flex items-center justify-between gap-3">
              <label :for="paragraphSpacingInputId" class="settings-label">
                {{ t('settings.reader.ebook.paragraphSpacing') }}
              </label>
              <span class="settings-value">{{ paragraphSpacingLabel }}</span>
            </div>
            <p class="settings-hint">
              {{ t('settings.reader.ebook.paragraphSpacingHint') }}
            </p>
          </div>
          <input
            :id="paragraphSpacingInputId"
            type="range"
            :min="EPUB_PARAGRAPH_SPACING_MIN"
            :max="EPUB_PARAGRAPH_SPACING_MAX"
            step="0.1"
            class="w-full accent-primary cursor-pointer"
            :value="effective.paragraphSpacing"
            :aria-valuetext="paragraphSpacingLabel"
            @input="setParagraphSpacing"
          />
        </div>

        <!-- Justify -->
        <div class="settings-row">
          <div>
            <p class="settings-label">
              {{ t('settings.reader.ebook.justify') }}
            </p>
            <p class="settings-hint">
              {{ t('settings.reader.ebook.justifyHint') }}
            </p>
          </div>
          <ToggleSwitch class="self-start" :model-value="effective.justify" @update:model-value="update({ justify: $event })" />
        </div>

        <!-- Hyphenation -->
        <div class="settings-row">
          <div>
            <p class="settings-label">
              {{ t('settings.reader.ebook.hyphenation') }}
            </p>
            <p class="settings-hint">
              {{ t('settings.reader.ebook.hyphenationHint') }}
            </p>
          </div>
          <ToggleSwitch class="self-start" :model-value="effective.hyphenate" @update:model-value="update({ hyphenate: $event })" />
        </div>
      </div>
    </div>

    <!-- Advanced -->
    <div class="mb-6">
      <p class="settings-group-label">
        {{ t('settings.reader.ebook.advanced') }}
      </p>
      <div class="settings-card">
        <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div class="mb-3 flex items-start justify-between gap-3">
            <div>
              <label :for="letterSpacingSourceId" class="settings-label">{{ t('settings.reader.ebook.letterSpacing') }}</label>
              <p class="settings-hint">
                {{ t('settings.reader.ebook.letterSpacingHint') }}
              </p>
            </div>
            <select
              :id="letterSpacingSourceId"
              class="text-xs border border-border rounded-md px-2 py-1.5 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              :value="effective.letterSpacing === null ? 'book' : 'custom'"
              @change="setLetterSpacingSource"
            >
              <option value="book">
                {{ t('settings.reader.ebook.bookDefault') }}
              </option>
              <option value="custom">
                {{ t('settings.reader.ebook.custom') }}
              </option>
            </select>
          </div>
          <div v-if="effective.letterSpacing !== null" class="flex items-center gap-3">
            <input
              :id="letterSpacingInputId"
              type="range"
              :min="EPUB_LETTER_SPACING_MIN"
              :max="EPUB_LETTER_SPACING_MAX"
              step="0.01"
              class="w-full accent-primary cursor-pointer"
              :value="letterSpacingValue"
              :aria-label="t('settings.reader.ebook.letterSpacing')"
              :aria-valuetext="letterSpacingLabel"
              @input="setLetterSpacing"
            />
            <span class="settings-value w-16 text-right">{{ letterSpacingLabel }}</span>
          </div>
        </div>

        <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div class="mb-3 flex items-start justify-between gap-3">
            <div>
              <label :for="wordSpacingSourceId" class="settings-label">{{ t('settings.reader.ebook.wordSpacing') }}</label>
              <p class="settings-hint">
                {{ t('settings.reader.ebook.wordSpacingHint') }}
              </p>
            </div>
            <select
              :id="wordSpacingSourceId"
              class="text-xs border border-border rounded-md px-2 py-1.5 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              :value="effective.wordSpacing === null ? 'book' : 'custom'"
              @change="setWordSpacingSource"
            >
              <option value="book">
                {{ t('settings.reader.ebook.bookDefault') }}
              </option>
              <option value="custom">
                {{ t('settings.reader.ebook.custom') }}
              </option>
            </select>
          </div>
          <div v-if="effective.wordSpacing !== null" class="flex items-center gap-3">
            <input
              :id="wordSpacingInputId"
              type="range"
              :min="EPUB_WORD_SPACING_MIN"
              :max="EPUB_WORD_SPACING_MAX"
              step="0.05"
              class="w-full accent-primary cursor-pointer"
              :value="wordSpacingValue"
              :aria-label="t('settings.reader.ebook.wordSpacing')"
              :aria-valuetext="wordSpacingLabel"
              @input="setWordSpacing"
            />
            <span class="settings-value w-16 text-right">{{ wordSpacingLabel }}</span>
          </div>
        </div>

        <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div class="mb-3 flex items-start justify-between gap-3">
            <div>
              <label :for="textIndentSourceId" class="settings-label">{{ t('settings.reader.ebook.textIndent') }}</label>
              <p class="settings-hint">
                {{ t('settings.reader.ebook.textIndentHint') }}
              </p>
            </div>
            <select
              :id="textIndentSourceId"
              class="text-xs border border-border rounded-md px-2 py-1.5 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              :value="effective.textIndent === null ? 'book' : 'custom'"
              @change="setTextIndentSource"
            >
              <option value="book">
                {{ t('settings.reader.ebook.bookDefault') }}
              </option>
              <option value="custom">
                {{ t('settings.reader.ebook.custom') }}
              </option>
            </select>
          </div>
          <div v-if="effective.textIndent !== null" class="flex items-center gap-3">
            <input
              :id="textIndentInputId"
              type="range"
              :min="EPUB_TEXT_INDENT_MIN"
              :max="EPUB_TEXT_INDENT_MAX"
              step="0.25"
              class="w-full accent-primary cursor-pointer"
              :value="textIndentValue"
              :aria-label="t('settings.reader.ebook.textIndent')"
              :aria-valuetext="textIndentLabel"
              @input="setTextIndent"
            />
            <span class="settings-value w-16 text-right">{{ textIndentLabel }}</span>
          </div>
        </div>

        <!-- Max inline size -->
        <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div class="mb-3">
            <div class="flex items-center justify-between gap-3">
              <p class="settings-label">
                {{ t('settings.reader.ebook.maxContentWidth') }}
              </p>
              <span class="settings-value">{{ effective.maxInlineSize }}px</span>
            </div>
            <p class="settings-hint">
              {{ t('settings.reader.ebook.maxContentWidthHint') }}
            </p>
          </div>
          <input
            type="range"
            min="400"
            max="1600"
            step="40"
            class="w-full accent-primary cursor-pointer"
            :value="effective.maxInlineSize"
            @input="
              update({
                maxInlineSize: Number(($event.target as HTMLInputElement).value),
              })
            "
          />
        </div>

        <!-- Gap -->
        <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div class="mb-3">
            <div class="flex items-center justify-between gap-3">
              <p class="settings-label">
                {{ t('settings.reader.ebook.columnGap') }}
              </p>
              <span class="settings-value">{{ Math.round(effective.gap * 100) }}%</span>
            </div>
            <p class="settings-hint">
              {{ t('settings.reader.ebook.columnGapHint') }}
            </p>
          </div>
          <input
            type="range"
            min="0"
            max="0.5"
            step="0.01"
            class="w-full accent-primary cursor-pointer"
            :value="effective.gap"
            @input="update({ gap: Number(($event.target as HTMLInputElement).value) })"
          />
        </div>
      </div>
    </div>

    <SettingsResetAction @reset="reset" />
  </div>
</template>
