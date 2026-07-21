<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Image } from '@lucide/vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import {
  useDisplaySettings,
  type BookCoverDisplayMode,
  type BookShadowStrength,
  type BookSpineOverlay,
  type CardOverlayKey,
} from '@/composables/useDisplaySettings'

const { t } = useI18n()

const { cardOverlays, bookSpineOverlay, showSpineOnComics, bookShadowStrength, bookCoverDisplayMode } = useDisplaySettings()

const overlayOptions = computed<{ key: CardOverlayKey; label: string; hint: string }[]>(() => [
  {
    key: 'progress-bar',
    label: t('settings.appearance.bookCovers.overlays.progressBar.label'),
    hint: t('settings.appearance.bookCovers.overlays.progressBar.hint'),
  },
  { key: 'format', label: t('settings.appearance.bookCovers.overlays.format.label'), hint: t('settings.appearance.bookCovers.overlays.format.hint') },
  { key: 'rating', label: t('settings.appearance.bookCovers.overlays.rating.label'), hint: t('settings.appearance.bookCovers.overlays.rating.hint') },
  {
    key: 'read-status',
    label: t('settings.appearance.bookCovers.overlays.readStatus.label'),
    hint: t('settings.appearance.bookCovers.overlays.readStatus.hint'),
  },
  {
    key: 'series-position',
    label: t('settings.appearance.bookCovers.overlays.seriesPosition.label'),
    hint: t('settings.appearance.bookCovers.overlays.seriesPosition.hint'),
  },
  {
    key: 'lock-status',
    label: t('settings.appearance.bookCovers.overlays.lockStatus.label'),
    hint: t('settings.appearance.bookCovers.overlays.lockStatus.hint'),
  },
])

const bookSpineOptions = computed<{ id: BookSpineOverlay; label: string; hint: string }[]>(() => [
  { id: 'off', label: t('settings.appearance.bookCovers.spine.off.label'), hint: t('settings.appearance.bookCovers.spine.off.hint') },
  { id: 'subtle', label: t('settings.appearance.bookCovers.spine.subtle.label'), hint: t('settings.appearance.bookCovers.spine.subtle.hint') },
  { id: 'strong', label: t('settings.appearance.bookCovers.spine.strong.label'), hint: t('settings.appearance.bookCovers.spine.strong.hint') },
])

const bookShadowOptions = computed<{ id: BookShadowStrength; label: string; hint: string }[]>(() => [
  { id: 'default', label: t('settings.appearance.bookCovers.shadow.default.label'), hint: t('settings.appearance.bookCovers.shadow.default.hint') },
  { id: 'strong', label: t('settings.appearance.bookCovers.shadow.strong.label'), hint: t('settings.appearance.bookCovers.shadow.strong.hint') },
])

const bookCoverDisplayOptions = computed<{ id: BookCoverDisplayMode; label: string; hint: string }[]>(() => [
  {
    id: 'blurred-fit',
    label: t('settings.appearance.bookCovers.displayMode.blurredFit.label'),
    hint: t('settings.appearance.bookCovers.displayMode.blurredFit.hint'),
  },
  {
    id: 'fill-crop',
    label: t('settings.appearance.bookCovers.displayMode.fillCrop.label'),
    hint: t('settings.appearance.bookCovers.displayMode.fillCrop.hint'),
  },
  {
    id: 'natural-bottom',
    label: t('settings.appearance.bookCovers.displayMode.naturalBottom.label'),
    hint: t('settings.appearance.bookCovers.displayMode.naturalBottom.hint'),
  },
])

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
    <p class="settings-group-label">{{ t('settings.appearance.bookCovers.title') }}</p>
    <div class="border border-border rounded-lg overflow-hidden divide-y divide-border mb-4 shadow-xs">
      <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
        <div>
          <p class="settings-label">{{ t('settings.appearance.bookCovers.displayMode.title') }}</p>
          <p class="settings-hint">{{ t('settings.appearance.bookCovers.displayMode.hint') }}</p>
        </div>
        <div class="mt-3 grid gap-2 md:grid-cols-3">
          <button
            v-for="opt in bookCoverDisplayOptions"
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
          <p class="settings-label">{{ t('settings.appearance.bookCovers.spine.title') }}</p>
          <p class="settings-hint">{{ t('settings.appearance.bookCovers.spine.hint') }}</p>
        </div>
        <div class="mt-3 grid gap-2 sm:grid-cols-3">
          <button
            v-for="opt in bookSpineOptions"
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
          <p class="settings-label">{{ t('settings.appearance.bookCovers.showSpineOnComics.label') }}</p>
          <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:whitespace-normal md:overflow-visible">
            {{ t('settings.appearance.bookCovers.showSpineOnComics.hint') }}
          </p>
        </div>
        <ToggleSwitch v-model="showSpineOnComics" />
      </div>
      <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
        <div>
          <p class="settings-label">{{ t('settings.appearance.bookCovers.shadow.title') }}</p>
          <p class="settings-hint">{{ t('settings.appearance.bookCovers.shadow.hint') }}</p>
        </div>
        <div class="mt-3 flex items-center gap-1 p-1 rounded-lg border border-border bg-muted/50 self-start">
          <button
            v-for="opt in bookShadowOptions"
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
        <p class="settings-label">{{ t('settings.appearance.bookCovers.overlays.title') }}</p>
        <p class="settings-hint">{{ t('settings.appearance.bookCovers.overlays.hint') }}</p>
      </div>
      <div v-for="opt in overlayOptions" :key="opt.key" class="flex items-center justify-between gap-3 px-4 py-3 md:px-5 md:py-3.5 bg-card">
        <div class="min-w-0">
          <p class="settings-label">{{ opt.label }}</p>
          <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:whitespace-normal md:overflow-visible">{{ opt.hint }}</p>
        </div>
        <ToggleSwitch :model-value="cardOverlays.includes(opt.key)" @update:model-value="toggleOverlay(opt.key)" />
      </div>
    </div>
  </div>
</template>
