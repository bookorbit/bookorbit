<script setup lang="ts">
import { computed } from 'vue'
import { ACCENT_VIVID, ACCENT_PASTEL, BACKGROUND_OPTIONS, RADIUS_OPTIONS, useThemeStore } from '@/stores/theme'
import { Circle, Moon, Square, Sun } from 'lucide-vue-next'
import {
  useDisplaySettings,
  type BookShadowStrength,
  type BookSpineOverlay,
  type CardOverlayKey,
  type CoverSizeScope,
} from '@/composables/useDisplaySettings'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import SettingsPageHeader from './SettingsPageHeader.vue'
import { useSeriesCollapsePreference } from '@/features/book/composables/useSeriesCollapsePreference'

const themeStore = useThemeStore()
const {
  portraitCoverSize,
  squareCoverSize,
  coverSizeScope,
  portraitGridGap,
  squareGridGap,
  cardOverlays,
  smartScopeFilterExpanded,
  authorCoverSize,
  authorCoverShape,
  tableZebraStriping,
  bookSpineOverlay,
  bookShadowStrength,
} = useDisplaySettings()

const { prefs, setPreference } = useSeriesCollapsePreference()
const globalCollapseEnabled = computed(() => prefs.value?.global ?? false)

async function handleGlobalCollapseToggle(value: boolean) {
  await setPreference('global', value)
}

const OVERLAY_OPTIONS: { key: CardOverlayKey; label: string; hint: string }[] = [
  { key: 'progress-bar', label: 'Progress bar', hint: 'Thin colored line along the bottom edge' },
  { key: 'format', label: 'File format', hint: 'Color-coded EPUB, PDF, CBZ badge at bottom-right' },
  { key: 'rating', label: 'Rating', hint: 'Star rating indicator at bottom-left' },
  { key: 'read-status', label: 'Read status', hint: 'Color icon showing the current reading status at top-left' },
  { key: 'series-position', label: 'Series number', hint: 'Badge showing the book position in its series at top-right (e.g. #3, #1.5)' },
  { key: 'lock-status', label: 'Lock status', hint: 'Metadata lock icon at top-right - orange when locked, green when unlocked' },
]

const BOOK_SPINE_OPTIONS: { id: BookSpineOverlay; label: string; hint: string }[] = [
  { id: 'off', label: 'Off', hint: 'No spine/gloss effect on covers' },
  { id: 'subtle', label: 'Subtle', hint: 'Light spine and sheen, closer to the default look' },
  { id: 'strong', label: 'Strong', hint: 'More pronounced spine and gloss treatment' },
]

const BOOK_SHADOW_OPTIONS: { id: BookShadowStrength; label: string; hint: string }[] = [
  { id: 'default', label: 'Default', hint: 'Current elevation and depth' },
  { id: 'strong', label: 'Strong', hint: 'Heavier shelf-like drop shadow under covers' },
]

const BACKGROUND_GROUPS: { label: string; ids: string[] }[] = [
  { label: 'Fundamental', ids: ['none', 'dots', 'cross', 'terminal', 'millimeter'] },
  { label: 'Structural', ids: ['blueprint', 'brushed', 'scanlines', 'vinyl', 'carbon', 'perforated'] },
  { label: 'Ambient', ids: ['aurora', 'horizon', 'glow', 'mesh', 'elevation'] },
  { label: 'Refractive', ids: ['prism', 'spectrum', 'spectrum-x', 'spectrum-plus', 'eclipse'] },
]

const accentLabel = computed(() => [...ACCENT_VIVID, ...ACCENT_PASTEL].find((opt) => opt.id === themeStore.accent)?.label ?? themeStore.accent)
const backgroundLabel = computed(() => BACKGROUND_OPTIONS.find((opt) => opt.id === themeStore.background)?.label ?? themeStore.background)

function toggleOverlay(key: CardOverlayKey) {
  const idx = cardOverlays.value.indexOf(key)
  if (idx === -1) cardOverlays.value = [...cardOverlays.value, key]
  else cardOverlays.value = cardOverlays.value.filter((k) => k !== key)
}

function setCoverSizeScope(mode: CoverSizeScope) {
  coverSizeScope.value = mode
}

function setBookSpineOverlay(mode: BookSpineOverlay) {
  bookSpineOverlay.value = mode
}

function setBookShadowStrength(mode: BookShadowStrength) {
  bookShadowStrength.value = mode
}

const syncModeEnabled = computed(() => coverSizeScope.value === 'synced')
</script>

<template>
  <SettingsPageHeader title="Appearance" subtitle="Customize how the app looks and feels." />
  <div
    class="md:hidden sticky top-0 z-20 -mx-4 mb-4 px-4 py-2 border-y border-border/70 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/75"
  >
    <p class="text-[11px] font-medium text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap">
      Theme: {{ themeStore.theme === 'dark' ? 'Dark' : 'Light' }} • Accent: {{ accentLabel }} • Background: {{ backgroundLabel }}
    </p>
  </div>

  <!-- Theme & colors -->
  <div class="mb-6">
    <p class="settings-group-label">Theme</p>
    <div class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
      <!-- Light / dark -->
      <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
        <div>
          <p class="settings-label">Color scheme</p>
          <p class="settings-hint">Light or dark interface</p>
        </div>
        <div class="flex items-center gap-1 p-1 rounded-lg border border-border bg-muted/50 self-start">
          <button
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            :class="themeStore.theme === 'light' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="themeStore.theme === 'dark' && themeStore.toggleTheme()"
          >
            <Sun :size="12" /> Light
          </button>
          <button
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            :class="themeStore.theme === 'dark' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="themeStore.theme === 'light' && themeStore.toggleTheme()"
          >
            <Moon :size="12" /> Dark
          </button>
        </div>
      </div>

      <!-- Accent color -->
      <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
        <p class="settings-label mb-0.5">Accent color</p>
        <p class="text-xs text-muted-foreground mb-3">Controls highlights and interactive elements</p>
        <div class="space-y-2">
          <div class="flex items-center gap-1.5 flex-wrap">
            <Tooltip v-for="opt in ACCENT_VIVID" :key="opt.id">
              <TooltipTrigger as-child>
                <button
                  class="w-7 h-7 md:w-5 md:h-5 rounded-full transition-all hover:scale-110 focus:outline-none shrink-0"
                  :style="{
                    backgroundColor: opt.color,
                    outline: themeStore.accent === opt.id ? `2px solid ${opt.color}` : 'none',
                    outlineOffset: '2px',
                    transform: themeStore.accent === opt.id ? 'scale(1.25)' : '',
                  }"
                  @click="themeStore.setAccent(opt.id)"
                />
              </TooltipTrigger>
              <TooltipContent>{{ opt.label }}</TooltipContent>
            </Tooltip>
          </div>
          <div class="flex items-center gap-1.5 flex-wrap">
            <Tooltip v-for="opt in ACCENT_PASTEL" :key="opt.id">
              <TooltipTrigger as-child>
                <button
                  class="w-7 h-7 md:w-5 md:h-5 rounded-full transition-all hover:scale-110 focus:outline-none shrink-0"
                  :style="{
                    backgroundColor: opt.color,
                    outline: themeStore.accent === opt.id ? `2px solid ${opt.color}` : 'none',
                    outlineOffset: '2px',
                    transform: themeStore.accent === opt.id ? 'scale(1.25)' : '',
                  }"
                  @click="themeStore.setAccent(opt.id)"
                />
              </TooltipTrigger>
              <TooltipContent>{{ opt.label }}</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      <!-- Corner radius -->
      <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
        <div>
          <p class="settings-label">Corner radius</p>
          <p class="settings-hint">Roundness of cards and UI elements</p>
        </div>
        <div class="flex items-center gap-1.5 self-start">
          <button
            v-for="opt in RADIUS_OPTIONS"
            :key="opt.id"
            class="h-7 px-3 text-xs border-2 transition-colors font-medium"
            :style="{ borderRadius: opt.id === 'sharp' ? '2px' : opt.id === 'default' ? '6px' : opt.id === 'rounded' ? '14px' : '999px' }"
            :class="
              themeStore.radius === opt.id
                ? 'border-primary text-primary bg-primary/8'
                : 'border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
            "
            @click="themeStore.setRadius(opt.id)"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <!-- Dark mode brightness -->
      <div v-if="themeStore.theme === 'dark'" class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
        <div class="mb-3">
          <div class="flex items-center justify-between gap-3 mb-0.5">
            <p class="settings-label">Surface brightness</p>
            <div class="flex items-center gap-2">
              <span class="settings-value md:hidden">{{ themeStore.brightness }}%</span>
              <button
                v-if="themeStore.brightness > 0"
                class="text-xs text-muted-foreground hover:text-foreground transition-colors"
                @click="themeStore.setBrightness(0)"
              >
                Reset
              </button>
            </div>
          </div>
          <p class="settings-hint">Lighten dark mode surfaces</p>
          <div>
            <span class="settings-value hidden md:inline">{{ themeStore.brightness }}%</span>
          </div>
        </div>
        <input
          :value="themeStore.brightness"
          @input="themeStore.setBrightness(Number(($event.target as HTMLInputElement).value))"
          type="range"
          min="0"
          max="100"
          step="5"
          class="w-full accent-primary cursor-pointer"
        />
      </div>
    </div>
  </div>

  <!-- Library view -->
  <div>
    <p class="settings-group-label">Library View</p>

    <!-- Cover styling -->
    <div class="border border-border rounded-lg overflow-hidden divide-y divide-border mb-4 shadow-xs">
      <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
        <div>
          <p class="settings-label">Book spine overlay</p>
          <p class="settings-hint">Adds a stylized spine and gloss effect to cover cards</p>
        </div>
        <div class="mt-3 grid gap-2 sm:grid-cols-3">
          <button
            v-for="opt in BOOK_SPINE_OPTIONS"
            :key="opt.id"
            class="rounded-md border px-3 py-2 text-left transition-colors"
            :class="
              bookSpineOverlay === opt.id
                ? 'border-primary bg-primary/8 text-primary'
                : 'border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
            "
            @click="setBookSpineOverlay(opt.id)"
          >
            <p class="text-xs font-semibold">{{ opt.label }}</p>
            <p class="mt-0.5 text-[11px] leading-snug opacity-80">{{ opt.hint }}</p>
          </button>
        </div>
      </div>
      <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
        <div>
          <p class="settings-label">Cover shadow strength</p>
          <p class="settings-hint">Controls depth under covers across grid, list, table, and dashboard thumbnails</p>
        </div>
        <div class="mt-3 flex items-center gap-1 p-1 rounded-lg border border-border bg-muted/50 self-start">
          <button
            v-for="opt in BOOK_SHADOW_OPTIONS"
            :key="opt.id"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            :class="bookShadowStrength === opt.id ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="setBookShadowStrength(opt.id)"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>
    </div>

    <!-- Background pattern -->
    <div class="border border-border rounded-lg overflow-hidden divide-y divide-border mb-4 shadow-xs">
      <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
        <div class="mb-3">
          <div>
            <p class="settings-label">Background pattern</p>
            <p class="settings-hint">Pattern shown behind the book grid</p>
          </div>
        </div>
        <div class="space-y-5 md:space-y-6">
          <div v-for="group in BACKGROUND_GROUPS" :key="group.label">
            <p class="text-[10px] font-bold text-muted-foreground/80 uppercase tracking-widest mb-2.5 ml-0.5">{{ group.label }}</p>
            <div
              class="flex items-center gap-3 md:gap-4 overflow-x-auto md:overflow-visible md:flex-wrap pb-1 pt-0.5 px-0.5 md:pt-0 md:px-0 md:pb-0 no-scrollbar"
            >
              <Tooltip v-for="opt in BACKGROUND_OPTIONS.filter((o) => group.ids.includes(o.id))" :key="opt.id">
                <TooltipTrigger as-child>
                  <button
                    type="button"
                    class="w-14 h-10 rounded overflow-hidden transition-all ring-2 focus:outline-none shrink-0"
                    :class="
                      themeStore.background === opt.id ? 'ring-primary shadow-xs shadow-primary/20' : 'ring-border hover:ring-muted-foreground/40'
                    "
                    @click="themeStore.setBackground(opt.id)"
                  >
                    <div class="w-full h-full bg-background [transform:translate(0)] pattern-preview" :class="opt.cssClass" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{{ opt.label }}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
      <!-- Cover size behavior -->
      <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
        <div>
          <p class="settings-label">Cover size behavior</p>
          <p class="settings-hint">Control whether portrait/square sizes and grid spacing are shared across all views or kept per-view</p>
          <p v-if="!syncModeEnabled" class="settings-hint mt-1">Per-view mode: adjust cover size and spacing from each view’s Display panel.</p>
        </div>
        <div class="flex items-center gap-1 p-1 rounded-lg border border-border bg-muted/50 self-start">
          <button
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            :class="coverSizeScope === 'synced' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="setCoverSizeScope('synced')"
          >
            Sync all views
          </button>
          <button
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            :class="coverSizeScope === 'per-view' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="setCoverSizeScope('per-view')"
          >
            Per-view sizes
          </button>
        </div>
      </div>

      <!-- Portrait cover size -->
      <div
        class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card"
        :class="{ 'opacity-60': !syncModeEnabled }"
      >
        <div>
          <p class="settings-label">Portrait cover size</p>
          <p class="settings-hint">Used for portrait libraries and views</p>
        </div>
        <div class="w-full md:w-72">
          <div class="mb-1.5 flex items-center justify-between gap-3">
            <span class="text-xs text-muted-foreground">Cover size</span>
            <span class="text-xs font-medium tabular-nums text-foreground">{{ portraitCoverSize }}px</span>
          </div>
          <input
            :value="portraitCoverSize"
            @input="portraitCoverSize = Number(($event.target as HTMLInputElement).value)"
            type="range"
            min="100"
            max="280"
            step="10"
            class="w-full accent-primary cursor-pointer"
            :disabled="!syncModeEnabled"
          />
        </div>
      </div>

      <!-- Square cover size -->
      <div
        class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card"
        :class="{ 'opacity-60': !syncModeEnabled }"
      >
        <div>
          <p class="settings-label">Square cover size</p>
          <p class="settings-hint">Used for square libraries and views</p>
        </div>
        <div class="w-full md:w-72">
          <div class="mb-1.5 flex items-center justify-between gap-3">
            <span class="text-xs text-muted-foreground">Cover size</span>
            <span class="text-xs font-medium tabular-nums text-foreground">{{ squareCoverSize }}px</span>
          </div>
          <input
            :value="squareCoverSize"
            @input="squareCoverSize = Number(($event.target as HTMLInputElement).value)"
            type="range"
            min="100"
            max="280"
            step="10"
            class="w-full accent-primary cursor-pointer"
            :disabled="!syncModeEnabled"
          />
        </div>
      </div>

      <!-- Portrait grid gap -->
      <div
        class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card"
        :class="{ 'opacity-60': !syncModeEnabled }"
      >
        <div>
          <p class="settings-label">Portrait grid spacing</p>
          <p class="settings-hint">Gap between portrait covers</p>
        </div>
        <div class="w-full md:w-72">
          <div class="mb-1.5 flex items-center justify-between gap-3">
            <span class="text-xs text-muted-foreground">Grid spacing</span>
            <span class="text-xs font-medium tabular-nums text-foreground">{{ portraitGridGap }}px</span>
          </div>
          <input
            :value="portraitGridGap"
            @input="portraitGridGap = Number(($event.target as HTMLInputElement).value)"
            type="range"
            min="4"
            max="40"
            step="4"
            class="w-full accent-primary cursor-pointer"
            :disabled="!syncModeEnabled"
          />
        </div>
      </div>

      <!-- Square grid gap -->
      <div
        class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card"
        :class="{ 'opacity-60': !syncModeEnabled }"
      >
        <div>
          <p class="settings-label">Square grid spacing</p>
          <p class="settings-hint">Gap between square covers</p>
        </div>
        <div class="w-full md:w-72">
          <div class="mb-1.5 flex items-center justify-between gap-3">
            <span class="text-xs text-muted-foreground">Grid spacing</span>
            <span class="text-xs font-medium tabular-nums text-foreground">{{ squareGridGap }}px</span>
          </div>
          <input
            :value="squareGridGap"
            @input="squareGridGap = Number(($event.target as HTMLInputElement).value)"
            type="range"
            min="4"
            max="40"
            step="4"
            class="w-full accent-primary cursor-pointer"
            :disabled="!syncModeEnabled"
          />
        </div>
      </div>
    </div>

    <!-- Card overlays -->
    <p class="settings-group-label mt-6">Author Grid</p>
    <div class="border border-border rounded-lg overflow-hidden divide-y divide-border mb-6 shadow-xs">
      <!-- Author cover size -->
      <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
        <div>
          <p class="settings-label">Cover size</p>
          <p class="settings-hint">Width of author covers in the grid</p>
        </div>
        <div class="w-full md:w-72">
          <div class="mb-1.5 flex items-center justify-between gap-3">
            <span class="text-xs text-muted-foreground">Cover size</span>
            <span class="text-xs font-medium tabular-nums text-foreground">{{ authorCoverSize }}px</span>
          </div>
          <input
            :value="authorCoverSize"
            @input="authorCoverSize = Number(($event.target as HTMLInputElement).value)"
            type="range"
            min="100"
            max="280"
            step="10"
            class="w-full accent-primary cursor-pointer"
          />
        </div>
      </div>

      <!-- Author cover shape -->
      <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
        <div>
          <p class="settings-label">Cover shape</p>
          <p class="settings-hint">Shape of author covers in the grid</p>
        </div>
        <div class="flex items-center gap-1 p-1 rounded-lg border border-border bg-muted/50 self-start">
          <button
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            :class="authorCoverShape === 'circle' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="authorCoverShape = 'circle'"
          >
            <Circle :size="12" /> Circle
          </button>
          <button
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            :class="authorCoverShape === 'square' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="authorCoverShape = 'square'"
          >
            <Square :size="12" /> Square
          </button>
        </div>
      </div>
    </div>

    <!-- Card overlays -->
    <p class="settings-group-label">Card Overlays</p>
    <div class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
      <div v-for="opt in OVERLAY_OPTIONS" :key="opt.key" class="flex items-center justify-between gap-3 px-4 py-3 md:px-5 md:py-3.5 bg-card">
        <div class="min-w-0">
          <p class="settings-label">{{ opt.label }}</p>
          <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:whitespace-normal md:overflow-visible">{{ opt.hint }}</p>
        </div>
        <ToggleSwitch :model-value="cardOverlays.includes(opt.key)" @update:model-value="toggleOverlay(opt.key)" />
      </div>
    </div>
  </div>

  <!-- Table View -->
  <div class="mt-8">
    <p class="settings-group-label">Table View</p>
    <div class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
      <div class="flex items-center justify-between gap-3 px-4 py-3 md:px-5 md:py-3.5 bg-card">
        <div class="min-w-0">
          <p class="settings-label">Zebra striping</p>
          <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:whitespace-normal md:overflow-visible">
            Alternate row background colors for easier scanning
          </p>
        </div>
        <ToggleSwitch v-model="tableZebraStriping" />
      </div>
    </div>
  </div>

  <!-- SmartScopes -->
  <div class="mt-8">
    <p class="settings-group-label">Smart Scopes</p>
    <div class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
      <div class="flex items-center justify-between gap-3 px-4 py-3 md:px-5 md:py-3.5 bg-card">
        <div class="min-w-0">
          <p class="settings-label">Show filter preview by default</p>
          <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:whitespace-normal md:overflow-visible">
            Expand the active filter and sort summary when opening a smartScope
          </p>
        </div>
        <ToggleSwitch v-model="smartScopeFilterExpanded" />
      </div>
    </div>
  </div>

  <!-- Series -->
  <div class="mt-8">
    <p class="settings-group-label">Series</p>
    <div class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
      <div class="flex items-center justify-between gap-3 px-4 py-3 md:px-5 md:py-3.5 bg-card">
        <div class="min-w-0">
          <p class="settings-label">Collapse series by default</p>
          <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:whitespace-normal md:overflow-visible">
            Group books in the same series into a single card in library and collection views
          </p>
        </div>
        <ToggleSwitch :model-value="globalCollapseEnabled" @update:model-value="handleGlobalCollapseToggle" />
      </div>
    </div>
  </div>
</template>
