<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { EpubReaderSettings } from '@bookorbit/types'
import { fontCssFamilyGroupName } from '@bookorbit/types'
import { useReaderDefaultSettings } from '@/features/reader/shared/composables/useReaderSettings'
import { useCustomFonts } from '@/features/reader/epub/composables/useCustomFonts'
import { themes } from '@/features/reader/epub/constants/themes'
import { BUILTIN_READER_FONT_OPTIONS } from '@/features/reader/shared/constants/font-options'
import { formatFontFamilyLabel } from '@/features/reader/shared/lib/font-display'
import { Check } from 'lucide-vue-next'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import SettingsPageHeader from './SettingsPageHeader.vue'

const props = withDefaults(
  defineProps<{
    embedded?: boolean
  }>(),
  {
    embedded: false,
  },
)

const { effective, load, update, reset } = useReaderDefaultSettings<EpubReaderSettings>('epub')

const customFonts = useCustomFonts()

const customFontOptions = computed(() =>
  customFonts.families.value.map((f) => ({
    id: fontCssFamilyGroupName(f.name),
    label: formatFontFamilyLabel(f.name),
  })),
)

const previewStyleEl = ref<HTMLStyleElement | null>(null)

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

watch(
  () => customFonts.fonts.value,
  () => {
    injectPreviewStyles(customFonts.generateFontFaceCSS())

    // If the saved font family is a custom font that no longer exists, reset it.
    const saved = effective.value.fontFamily
    if (saved?.startsWith('__userfont_')) {
      const stillExists = customFonts.families.value.some((f) => fontCssFamilyGroupName(f.name) === saved)
      if (!stillExists) update({ fontFamily: null })
    }
  },
  { immediate: true },
)

onMounted(async () => {
  await load()
  await customFonts.fetchFonts()
})

onUnmounted(() => {
  previewStyleEl.value?.remove()
  previewStyleEl.value = null
})
</script>

<template>
  <div
    class="[&_.settings-hint]:overflow-hidden [&_.settings-hint]:text-ellipsis [&_.settings-hint]:whitespace-nowrap md:[&_.settings-hint]:overflow-visible md:[&_.settings-hint]:whitespace-normal"
  >
    <SettingsPageHeader v-if="!props.embedded" title="eBook Reader" subtitle="Default settings applied when opening EPUB, MOBI, FB2, and TXT files.">
      <button class="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2" @click="reset()">
        Reset to defaults
      </button>
    </SettingsPageHeader>
    <template v-else>
      <div
        class="md:hidden sticky top-[5.25rem] z-10 -mx-4 mb-4 px-4 py-2 border-y border-border/70 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/75"
      >
        <button class="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2" @click="reset()">
          Reset to defaults
        </button>
      </div>
      <div class="hidden md:flex justify-end mb-4">
        <button class="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2" @click="reset()">
          Reset to defaults
        </button>
      </div>
    </template>

    <!-- Formatting source -->
    <div class="mb-6">
      <p class="settings-group-label">New Books</p>
      <div class="border border-border rounded-lg overflow-hidden bg-card">
        <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between px-4 py-3.5 md:px-5 md:py-4">
          <div>
            <p class="settings-label">Apply my settings to new books</p>
            <p class="settings-hint">
              When off, new books open with the publisher's own fonts and layout. Your settings only apply once you change something in-reader.
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
      <p class="settings-group-label">Layout</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <!-- Flow -->
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">Reading flow</p>
            <p class="settings-hint">Paginated flips pages; scrolled flows continuously</p>
          </div>
          <div class="flex flex-wrap items-center gap-1.5 p-1 rounded-lg border border-border bg-muted/50 self-start">
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="effective.flow === 'paginated' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ flow: 'paginated' })"
            >
              Paginated
            </button>
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="effective.flow === 'scrolled' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ flow: 'scrolled' })"
            >
              Scrolled
            </button>
          </div>
        </div>

        <!-- Columns -->
        <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div class="mb-3">
            <div class="flex items-center justify-between gap-3">
              <p class="settings-label">Columns</p>
              <span class="settings-value">{{ effective.maxColumnCount }}</span>
            </div>
            <p class="settings-hint">Number of text columns per page</p>
          </div>
          <input
            type="range"
            min="1"
            max="4"
            step="1"
            class="w-full accent-primary cursor-pointer"
            :value="effective.maxColumnCount"
            @input="update({ maxColumnCount: Number(($event.target as HTMLInputElement).value) })"
          />
        </div>
      </div>
    </div>

    <!-- Theme -->
    <div class="mb-6">
      <p class="settings-group-label">Theme</p>
      <div class="border border-border rounded-lg overflow-hidden bg-card px-4 py-3.5 md:px-5 md:py-4">
        <!-- Dark mode toggle -->
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">
          <div>
            <p class="settings-label">Dark mode</p>
            <p class="settings-hint">Use the dark variant of the selected theme</p>
          </div>
          <ToggleSwitch class="self-start" :model-value="effective.isDark" @update:model-value="update({ isDark: $event })" />
        </div>
        <!-- Theme swatches -->
        <div class="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-3">
          <button v-for="t in themes" :key="t.name" class="flex flex-col items-center gap-1.5 group" @click="update({ themeName: t.name })">
            <div
              class="relative w-full aspect-[4/3] rounded-lg overflow-hidden transition-all ring-2 ring-offset-2 ring-offset-card"
              :class="effective.themeName === t.name ? 'ring-primary' : 'ring-transparent group-hover:ring-border'"
              :style="{ background: effective.isDark ? t.dark.bg : t.light.bg }"
            >
              <!-- Top accent strip -->
              <div class="absolute top-0 left-0 right-0 h-[3px]" :style="{ background: effective.isDark ? t.dark.link : t.light.link }" />
              <!-- Title line -->
              <div
                class="absolute top-[10px] left-[8px] right-[12px] h-[3px] rounded-full"
                :style="{ background: effective.isDark ? t.dark.fg : t.light.fg, opacity: 0.85 }"
              />
              <!-- Body text lines -->
              <div
                class="absolute top-[18px] left-[8px] right-[8px] h-[2px] rounded-full"
                :style="{ background: effective.isDark ? t.dark.fg : t.light.fg, opacity: 0.35 }"
              />
              <div
                class="absolute top-[23px] left-[8px] right-[16px] h-[2px] rounded-full"
                :style="{ background: effective.isDark ? t.dark.fg : t.light.fg, opacity: 0.35 }"
              />
              <div
                class="absolute top-[28px] left-[8px] right-[10px] h-[2px] rounded-full"
                :style="{ background: effective.isDark ? t.dark.fg : t.light.fg, opacity: 0.35 }"
              />
              <!-- Link dot -->
              <div
                class="absolute bottom-[7px] left-[8px] h-[2px] w-[14px] rounded-full opacity-80"
                :style="{ background: effective.isDark ? t.dark.link : t.light.link }"
              />
              <!-- Selected checkmark -->
              <Transition
                enter-active-class="transition-opacity duration-150"
                leave-active-class="transition-opacity duration-150"
                enter-from-class="opacity-0"
                leave-to-class="opacity-0"
              >
                <div
                  v-if="effective.themeName === t.name"
                  class="absolute bottom-[5px] right-[6px] w-4 h-4 rounded-full bg-primary flex items-center justify-center shadow"
                >
                  <Check :size="9" class="text-primary-foreground" :stroke-width="3" />
                </div>
              </Transition>
            </div>
            <span
              class="text-xs font-medium transition-colors leading-none text-center"
              :class="effective.themeName === t.name ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'"
            >
              {{ t.label }}
            </span>
          </button>
        </div>
      </div>
    </div>

    <!-- Typography -->
    <div class="mb-6">
      <p class="settings-group-label">Typography</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <!-- Font family -->
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">Font</p>
            <p class="settings-hint">Typeface used for body text</p>
          </div>
          <select
            class="text-xs border border-border rounded-md px-2 py-2 md:py-1.5 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary self-start min-w-40"
            :value="effective.fontFamily ?? ''"
            @change="update({ fontFamily: ($event.target as HTMLSelectElement).value || null })"
          >
            <optgroup label="Built-in fonts">
              <option v-for="f in BUILTIN_READER_FONT_OPTIONS" :key="String(f.value)" :value="f.value ?? ''">{{ f.label }}</option>
            </optgroup>
            <optgroup v-if="customFontOptions.length > 0" label="Your Fonts">
              <option v-for="f in customFontOptions" :key="f.id" :value="f.id">{{ f.label }}</option>
            </optgroup>
          </select>
        </div>

        <!-- Font size -->
        <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div class="mb-3">
            <div class="flex items-center justify-between gap-3">
              <p class="settings-label">Font size</p>
              <span class="settings-value">{{ effective.fontSize }}px</span>
            </div>
            <p class="settings-hint">Base text size in pixels</p>
          </div>
          <input
            type="range"
            min="10"
            max="32"
            step="1"
            class="w-full accent-primary cursor-pointer"
            :value="effective.fontSize"
            @input="update({ fontSize: Number(($event.target as HTMLInputElement).value) })"
          />
        </div>

        <!-- Line height -->
        <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div class="mb-3">
            <div class="flex items-center justify-between gap-3">
              <p class="settings-label">Line height</p>
              <span class="settings-value">{{ effective.lineHeight.toFixed(1) }}</span>
            </div>
            <p class="settings-hint">Vertical spacing between lines</p>
          </div>
          <input
            type="range"
            min="0.8"
            max="3"
            step="0.1"
            class="w-full accent-primary cursor-pointer"
            :value="effective.lineHeight"
            @input="update({ lineHeight: Number(($event.target as HTMLInputElement).value) })"
          />
        </div>

        <!-- Justify -->
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">Justify text</p>
            <p class="settings-hint">Align text to both margins</p>
          </div>
          <ToggleSwitch class="self-start" :model-value="effective.justify" @update:model-value="update({ justify: $event })" />
        </div>

        <!-- Hyphenation -->
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">Hyphenation</p>
            <p class="settings-hint">Automatically break long words with hyphens</p>
          </div>
          <ToggleSwitch class="self-start" :model-value="effective.hyphenate" @update:model-value="update({ hyphenate: $event })" />
        </div>
      </div>
    </div>

    <!-- Advanced -->
    <div class="mb-6">
      <p class="settings-group-label">Advanced</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <!-- Max inline size -->
        <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div class="mb-3">
            <div class="flex items-center justify-between gap-3">
              <p class="settings-label">Max content width</p>
              <span class="settings-value">{{ effective.maxInlineSize }}px</span>
            </div>
            <p class="settings-hint">Maximum width of the text area in pixels</p>
          </div>
          <input
            type="range"
            min="400"
            max="1600"
            step="40"
            class="w-full accent-primary cursor-pointer"
            :value="effective.maxInlineSize"
            @input="update({ maxInlineSize: Number(($event.target as HTMLInputElement).value) })"
          />
        </div>

        <!-- Gap -->
        <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div class="mb-3">
            <div class="flex items-center justify-between gap-3">
              <p class="settings-label">Column gap</p>
              <span class="settings-value">{{ Math.round(effective.gap * 100) }}%</span>
            </div>
            <p class="settings-hint">Horizontal padding on each side of the text area</p>
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
  </div>
</template>
