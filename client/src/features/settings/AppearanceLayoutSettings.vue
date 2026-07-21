<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Circle, Square } from '@lucide/vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import {
  useDisplaySettings,
  type AuthorCoverShape,
  type CardInfoMode,
  type CoverSizeScope,
  type GridCardLabelField,
  type SeriesCardCoverMode,
} from '@/composables/useDisplaySettings'

const { t } = useI18n()

const {
  portraitCoverSize,
  squareCoverSize,
  coverSizeScope,
  portraitGridGap,
  squareGridGap,
  authorCoverSize,
  authorCoverShape,
  tableZebraStriping,
  seriesCardCoverMode,
  gridCardPrimaryLabel,
  gridCardSecondaryLabel,
  cardInfoMode,
} = useDisplaySettings()

const syncModeEnabled = computed(() => coverSizeScope.value === 'synced')
const showLabelFields = computed(() => cardInfoMode.value === 'below-cover')

function setCoverSizeScope(mode: CoverSizeScope) {
  coverSizeScope.value = mode
}

function setAuthorCoverShape(shape: AuthorCoverShape) {
  authorCoverShape.value = shape
}

function setSeriesCardCoverMode(mode: SeriesCardCoverMode) {
  seriesCardCoverMode.value = mode
}

function setHoverOverlayMode() {
  cardInfoMode.value = 'hover-overlay' as CardInfoMode
}

function setBelowCoverMode() {
  cardInfoMode.value = 'below-cover' as CardInfoMode
}

function setOffMode() {
  cardInfoMode.value = 'off' as CardInfoMode
}

const labelFieldOptions = computed<{ value: GridCardLabelField; label: string }[]>(() => [
  { value: 'hidden', label: t('settings.appearance.layout.labelField.hidden') },
  { value: 'book-title', label: t('settings.appearance.layout.labelField.bookTitle') },
  { value: 'series-title', label: t('settings.appearance.layout.labelField.seriesTitle') },
  { value: 'series-title-position', label: t('settings.appearance.layout.labelField.seriesTitlePosition') },
  { value: 'author', label: t('settings.appearance.layout.labelField.author') },
])

function handlePrimaryLabelChange(event: Event) {
  gridCardPrimaryLabel.value = (event.target as HTMLSelectElement).value as GridCardLabelField
}

function handleSecondaryLabelChange(event: Event) {
  gridCardSecondaryLabel.value = (event.target as HTMLSelectElement).value as GridCardLabelField
}

function handlePortraitCoverSizeInput(event: Event) {
  portraitCoverSize.value = Number((event.target as HTMLInputElement).value)
}

function handleSquareCoverSizeInput(event: Event) {
  squareCoverSize.value = Number((event.target as HTMLInputElement).value)
}

function handlePortraitGridGapInput(event: Event) {
  portraitGridGap.value = Number((event.target as HTMLInputElement).value)
}

function handleSquareGridGapInput(event: Event) {
  squareGridGap.value = Number((event.target as HTMLInputElement).value)
}

function handleAuthorCoverSizeInput(event: Event) {
  authorCoverSize.value = Number((event.target as HTMLInputElement).value)
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <p class="settings-group-label">{{ t('settings.appearance.layout.gridLayout.title') }}</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">{{ t('settings.appearance.layout.coverSizeBehavior.label') }}</p>
            <p class="settings-hint">{{ t('settings.appearance.layout.coverSizeBehavior.hint') }}</p>
            <p v-if="!syncModeEnabled" class="settings-hint mt-1">{{ t('settings.appearance.layout.coverSizeBehavior.perViewHint') }}</p>
          </div>
          <div class="flex items-center gap-1 p-1 rounded-lg border border-border bg-muted/50 self-start">
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="coverSizeScope === 'synced' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="setCoverSizeScope('synced')"
            >
              {{ t('settings.appearance.layout.coverSizeBehavior.syncAll') }}
            </button>
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="coverSizeScope === 'per-view' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="setCoverSizeScope('per-view')"
            >
              {{ t('settings.appearance.layout.coverSizeBehavior.perView') }}
            </button>
          </div>
        </div>

        <div
          class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card"
          :class="{ 'opacity-60': !syncModeEnabled }"
        >
          <div>
            <p class="settings-label">{{ t('settings.appearance.layout.portraitCoverSize.label') }}</p>
            <p class="settings-hint">{{ t('settings.appearance.layout.portraitCoverSize.hint') }}</p>
          </div>
          <div class="w-full md:w-72">
            <div class="mb-1.5 flex items-center justify-between gap-3">
              <span class="text-xs text-muted-foreground">{{ t('settings.appearance.layout.coverSize') }}</span>
              <span class="text-xs font-medium tabular-nums text-foreground">{{ portraitCoverSize }}px</span>
            </div>
            <input
              :value="portraitCoverSize"
              type="range"
              min="100"
              max="280"
              step="10"
              class="w-full accent-primary cursor-pointer"
              :disabled="!syncModeEnabled"
              @input="handlePortraitCoverSizeInput"
            />
          </div>
        </div>

        <div
          class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card"
          :class="{ 'opacity-60': !syncModeEnabled }"
        >
          <div>
            <p class="settings-label">{{ t('settings.appearance.layout.squareCoverSize.label') }}</p>
            <p class="settings-hint">{{ t('settings.appearance.layout.squareCoverSize.hint') }}</p>
          </div>
          <div class="w-full md:w-72">
            <div class="mb-1.5 flex items-center justify-between gap-3">
              <span class="text-xs text-muted-foreground">{{ t('settings.appearance.layout.coverSize') }}</span>
              <span class="text-xs font-medium tabular-nums text-foreground">{{ squareCoverSize }}px</span>
            </div>
            <input
              :value="squareCoverSize"
              type="range"
              min="100"
              max="280"
              step="10"
              class="w-full accent-primary cursor-pointer"
              :disabled="!syncModeEnabled"
              @input="handleSquareCoverSizeInput"
            />
          </div>
        </div>

        <div
          class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card"
          :class="{ 'opacity-60': !syncModeEnabled }"
        >
          <div>
            <p class="settings-label">{{ t('settings.appearance.layout.portraitGridSpacing.label') }}</p>
            <p class="settings-hint">{{ t('settings.appearance.layout.portraitGridSpacing.hint') }}</p>
          </div>
          <div class="w-full md:w-72">
            <div class="mb-1.5 flex items-center justify-between gap-3">
              <span class="text-xs text-muted-foreground">{{ t('settings.appearance.layout.gridSpacing') }}</span>
              <span class="text-xs font-medium tabular-nums text-foreground">{{ portraitGridGap }}px</span>
            </div>
            <input
              :value="portraitGridGap"
              type="range"
              min="4"
              max="40"
              step="4"
              class="w-full accent-primary cursor-pointer"
              :disabled="!syncModeEnabled"
              @input="handlePortraitGridGapInput"
            />
          </div>
        </div>

        <div
          class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card"
          :class="{ 'opacity-60': !syncModeEnabled }"
        >
          <div>
            <p class="settings-label">{{ t('settings.appearance.layout.squareGridSpacing.label') }}</p>
            <p class="settings-hint">{{ t('settings.appearance.layout.squareGridSpacing.hint') }}</p>
          </div>
          <div class="w-full md:w-72">
            <div class="mb-1.5 flex items-center justify-between gap-3">
              <span class="text-xs text-muted-foreground">{{ t('settings.appearance.layout.gridSpacing') }}</span>
              <span class="text-xs font-medium tabular-nums text-foreground">{{ squareGridGap }}px</span>
            </div>
            <input
              :value="squareGridGap"
              type="range"
              min="4"
              max="40"
              step="4"
              class="w-full accent-primary cursor-pointer"
              :disabled="!syncModeEnabled"
              @input="handleSquareGridGapInput"
            />
          </div>
        </div>

        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">{{ t('settings.appearance.layout.cardInfoMode.label') }}</p>
            <p class="settings-hint">{{ t('settings.appearance.layout.cardInfoMode.hint') }}</p>
          </div>
          <div class="flex items-center gap-1 p-1 rounded-lg border border-border bg-muted/50 self-start">
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="cardInfoMode === 'hover-overlay' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="setHoverOverlayMode"
            >
              {{ t('settings.appearance.layout.cardInfoMode.onHover') }}
            </button>
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="cardInfoMode === 'below-cover' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="setBelowCoverMode"
            >
              {{ t('settings.appearance.layout.cardInfoMode.belowCover') }}
            </button>
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="cardInfoMode === 'off' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="setOffMode"
            >
              {{ t('settings.appearance.layout.cardInfoMode.off') }}
            </button>
          </div>
        </div>

        <Transition name="settings-expand">
          <div v-if="showLabelFields" class="divide-y divide-border">
            <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
              <div>
                <p class="settings-label">{{ t('settings.appearance.layout.primaryCardLabel.label') }}</p>
                <p class="settings-hint">{{ t('settings.appearance.layout.primaryCardLabel.hint') }}</p>
              </div>
              <select
                :value="gridCardPrimaryLabel"
                class="w-full md:w-48 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-xs focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer"
                @change="handlePrimaryLabelChange"
              >
                <option v-for="opt in labelFieldOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </select>
            </div>

            <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
              <div>
                <p class="settings-label">{{ t('settings.appearance.layout.secondaryCardLabel.label') }}</p>
                <p class="settings-hint">{{ t('settings.appearance.layout.secondaryCardLabel.hint') }}</p>
              </div>
              <select
                :value="gridCardSecondaryLabel"
                class="w-full md:w-48 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-xs focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer"
                @change="handleSecondaryLabelChange"
              >
                <option v-for="opt in labelFieldOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </select>
            </div>
          </div>
        </Transition>
      </div>
    </div>

    <div>
      <p class="settings-group-label">{{ t('settings.appearance.layout.seriesDisplay.title') }}</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">{{ t('settings.appearance.layout.seriesDisplay.collapsedCover.label') }}</p>
            <p class="settings-hint">{{ t('settings.appearance.layout.seriesDisplay.collapsedCover.hint') }}</p>
          </div>
          <div class="flex items-center gap-1 p-1 rounded-lg border border-border bg-muted/50 self-start">
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="seriesCardCoverMode === 'stack' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="setSeriesCardCoverMode('stack')"
            >
              {{ t('settings.appearance.layout.seriesDisplay.stack') }}
            </button>
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="seriesCardCoverMode === 'mosaic' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="setSeriesCardCoverMode('mosaic')"
            >
              {{ t('settings.appearance.layout.seriesDisplay.mosaic') }}
            </button>
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="
                seriesCardCoverMode === 'first-volume' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'
              "
              @click="setSeriesCardCoverMode('first-volume')"
            >
              {{ t('settings.appearance.layout.seriesDisplay.first') }}
            </button>
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="
                seriesCardCoverMode === 'latest-volume' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'
              "
              @click="setSeriesCardCoverMode('latest-volume')"
            >
              {{ t('settings.appearance.layout.seriesDisplay.latest') }}
            </button>
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="
                seriesCardCoverMode === 'first-unread' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'
              "
              @click="setSeriesCardCoverMode('first-unread')"
            >
              {{ t('settings.appearance.layout.seriesDisplay.firstUnread') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div>
      <p class="settings-group-label">{{ t('settings.appearance.layout.authorGrid.title') }}</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">{{ t('settings.appearance.layout.authorGrid.coverSize.label') }}</p>
            <p class="settings-hint">{{ t('settings.appearance.layout.authorGrid.coverSize.hint') }}</p>
          </div>
          <div class="w-full md:w-72">
            <div class="mb-1.5 flex items-center justify-between gap-3">
              <span class="text-xs text-muted-foreground">{{ t('settings.appearance.layout.coverSize') }}</span>
              <span class="text-xs font-medium tabular-nums text-foreground">{{ authorCoverSize }}px</span>
            </div>
            <input
              :value="authorCoverSize"
              type="range"
              min="100"
              max="280"
              step="10"
              class="w-full accent-primary cursor-pointer"
              @input="handleAuthorCoverSizeInput"
            />
          </div>
        </div>

        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">{{ t('settings.appearance.layout.authorGrid.coverShape.label') }}</p>
            <p class="settings-hint">{{ t('settings.appearance.layout.authorGrid.coverShape.hint') }}</p>
          </div>
          <div class="flex items-center gap-1 p-1 rounded-lg border border-border bg-muted/50 self-start">
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="authorCoverShape === 'circle' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="setAuthorCoverShape('circle')"
            >
              <Circle :size="12" /> {{ t('settings.appearance.layout.authorGrid.circle') }}
            </button>
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="authorCoverShape === 'square' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="setAuthorCoverShape('square')"
            >
              <Square :size="12" /> {{ t('settings.appearance.layout.authorGrid.square') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div>
      <p class="settings-group-label">{{ t('settings.appearance.layout.listTableViews.title') }}</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
        <div class="flex items-center justify-between gap-3 px-4 py-3 md:px-5 md:py-3.5 bg-card">
          <div class="min-w-0">
            <p class="settings-label">{{ t('settings.appearance.layout.zebraStriping.label') }}</p>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:whitespace-normal md:overflow-visible">
              {{ t('settings.appearance.layout.zebraStriping.hint') }}
            </p>
          </div>
          <ToggleSwitch v-model="tableZebraStriping" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-expand-enter-active,
.settings-expand-leave-active {
  transition:
    opacity 0.2s ease,
    max-height 0.25s ease;
  overflow: hidden;
  max-height: 300px;
}

.settings-expand-enter-from,
.settings-expand-leave-to {
  opacity: 0;
  max-height: 0;
}
</style>
