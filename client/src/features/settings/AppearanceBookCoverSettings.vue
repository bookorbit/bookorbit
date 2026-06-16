<script setup lang="ts">
import { Image } from 'lucide-vue-next'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import {
  useDisplaySettings,
  type BookCoverDisplayMode,
  type BookShadowStrength,
  type BookSpineOverlay,
  type CardOverlayKey,
} from '@/composables/useDisplaySettings'

const { cardOverlays, bookSpineOverlay, showSpineOnComics, bookShadowStrength, bookCoverDisplayMode } = useDisplaySettings()

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

const BOOK_COVER_DISPLAY_OPTIONS: { id: BookCoverDisplayMode; label: string; hint: string }[] = [
  { id: 'blurred-fit', label: 'Blurred fit', hint: 'Show the full cover with a blurred fill behind it' },
  { id: 'fill-crop', label: 'Fill card', hint: 'Fill the entire slot by cropping edges when aspect ratios differ' },
  { id: 'natural-bottom', label: 'Natural bottom', hint: 'Keep the original cover ratio and anchor the cover to the bottom' },
]

function toggleOverlay(key: CardOverlayKey) {
  const idx = cardOverlays.value.indexOf(key)
  if (idx === -1) cardOverlays.value = [...cardOverlays.value, key]
  else cardOverlays.value = cardOverlays.value.filter((k) => k !== key)
}

function setBookSpineOverlay(mode: BookSpineOverlay) {
  bookSpineOverlay.value = mode
}

function setBookShadowStrength(mode: BookShadowStrength) {
  bookShadowStrength.value = mode
}

function setBookCoverDisplayMode(mode: BookCoverDisplayMode) {
  bookCoverDisplayMode.value = mode
}
</script>

<template>
  <div>
    <p class="settings-group-label">Book Covers</p>
    <div class="border border-border rounded-lg overflow-hidden divide-y divide-border mb-4 shadow-xs">
      <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
        <div>
          <p class="settings-label">Cover display mode</p>
          <p class="settings-hint">Controls how real covers fit inside book slots when aspect ratios differ</p>
        </div>
        <div class="mt-3 grid gap-2 md:grid-cols-3">
          <button
            v-for="opt in BOOK_COVER_DISPLAY_OPTIONS"
            :key="opt.id"
            class="rounded-md border px-3 py-2 text-left transition-colors"
            :class="
              bookCoverDisplayMode === opt.id
                ? 'border-primary bg-primary/8 text-primary'
                : 'border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
            "
            @click="setBookCoverDisplayMode(opt.id)"
          >
            <span class="flex items-center gap-1.5 text-xs font-semibold">
              <Image :size="12" />
              {{ opt.label }}
            </span>
            <span class="mt-0.5 block text-[11px] leading-snug opacity-80">{{ opt.hint }}</span>
          </button>
        </div>
      </div>
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
      <div class="flex items-center justify-between gap-3 px-4 py-3.5 md:px-5 md:py-4 bg-card">
        <div class="min-w-0">
          <p class="settings-label">Show spine on comics</p>
          <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:whitespace-normal md:overflow-visible">
            Apply the spine and gloss effect to comic covers (cbz, cbr, cb7)
          </p>
        </div>
        <ToggleSwitch v-model="showSpineOnComics" />
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

    <div class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
      <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
        <p class="settings-label">Card overlays</p>
        <p class="settings-hint">Choose metadata shown directly on book cover cards</p>
      </div>
      <div v-for="opt in OVERLAY_OPTIONS" :key="opt.key" class="flex items-center justify-between gap-3 px-4 py-3 md:px-5 md:py-3.5 bg-card">
        <div class="min-w-0">
          <p class="settings-label">{{ opt.label }}</p>
          <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:whitespace-normal md:overflow-visible">{{ opt.hint }}</p>
        </div>
        <ToggleSwitch :model-value="cardOverlays.includes(opt.key)" @update:model-value="toggleOverlay(opt.key)" />
      </div>
    </div>
  </div>
</template>
