<script setup lang="ts">
import { computed } from 'vue'
import { Circle, Square } from 'lucide-vue-next'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { useDisplaySettings, type AuthorCoverShape, type CoverSizeScope } from '@/composables/useDisplaySettings'

const { portraitCoverSize, squareCoverSize, coverSizeScope, portraitGridGap, squareGridGap, authorCoverSize, authorCoverShape, tableZebraStriping } =
  useDisplaySettings()

const syncModeEnabled = computed(() => coverSizeScope.value === 'synced')

function setCoverSizeScope(mode: CoverSizeScope) {
  coverSizeScope.value = mode
}

function setAuthorCoverShape(shape: AuthorCoverShape) {
  authorCoverShape.value = shape
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
      <p class="settings-group-label">Library Grid Layout</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">Cover size behavior</p>
            <p class="settings-hint">Control whether portrait/square sizes and grid spacing are shared across all views or kept per-view</p>
            <p v-if="!syncModeEnabled" class="settings-hint mt-1">Per-view mode: adjust cover size and spacing from each view's Display panel.</p>
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
      </div>
    </div>

    <div>
      <p class="settings-group-label">Author Grid</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
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
            <p class="settings-label">Cover shape</p>
            <p class="settings-hint">Shape of author covers in the grid</p>
          </div>
          <div class="flex items-center gap-1 p-1 rounded-lg border border-border bg-muted/50 self-start">
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="authorCoverShape === 'circle' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="setAuthorCoverShape('circle')"
            >
              <Circle :size="12" /> Circle
            </button>
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="authorCoverShape === 'square' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="setAuthorCoverShape('square')"
            >
              <Square :size="12" /> Square
            </button>
          </div>
        </div>
      </div>
    </div>

    <div>
      <p class="settings-group-label">List and Table Views</p>
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
  </div>
</template>
