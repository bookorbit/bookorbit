<script setup lang="ts">
import { computed, onMounted } from 'vue'
import type { PdfReaderSettings } from '@projectx/types'
import { useReaderDefaultSettings } from '@/features/reader/composables/useReaderSettings'

const { effective, load, update, reset } = useReaderDefaultSettings<PdfReaderSettings>('pdf')

onMounted(load)

const showZoom = computed(() => effective.value.zoomMode === 'custom')
</script>

<template>
  <div class="px-5 py-6 sm:px-10 sm:py-8 max-w-3xl mx-auto">
    <div class="mb-8 flex items-start justify-between gap-4">
      <div>
        <h2 class="font-serif font-semibold text-foreground text-2xl tracking-tight">PDF Reader</h2>
        <p class="mt-1 text-sm text-muted-foreground">Default settings applied when opening PDF files.</p>
      </div>
      <button class="shrink-0 text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2" @click="reset()">
        Reset to defaults
      </button>
    </div>

    <!-- Layout -->
    <div class="mb-6">
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Layout</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <!-- Scroll mode -->
        <div class="flex items-center justify-between px-5 py-4 bg-card">
          <div>
            <p class="text-sm font-medium text-foreground">Scroll mode</p>
            <p class="text-xs text-muted-foreground mt-0.5">Page flips one at a time; continuous scrolls through all pages</p>
          </div>
          <div class="flex items-center gap-1 p-1 rounded-lg border border-border bg-muted/50">
            <button
              class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="effective.scrollMode === 'page' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ scrollMode: 'page' })"
            >
              Page
            </button>
            <button
              class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="
                effective.scrollMode === 'continuous' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
              "
              @click="update({ scrollMode: 'continuous' })"
            >
              Continuous
            </button>
          </div>
        </div>

        <!-- Page spread -->
        <div class="flex items-center justify-between px-5 py-4 bg-card">
          <div>
            <p class="text-sm font-medium text-foreground">Page spread</p>
            <p class="text-xs text-muted-foreground mt-0.5">Which page number starts on the right in two-page view</p>
          </div>
          <div class="flex items-center gap-1 p-1 rounded-lg border border-border bg-muted/50">
            <button
              class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="effective.spread === 'none' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ spread: 'none' })"
            >
              None
            </button>
            <button
              class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="effective.spread === 'odd' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ spread: 'odd' })"
            >
              Odd
            </button>
            <button
              class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="effective.spread === 'even' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ spread: 'even' })"
            >
              Even
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Zoom -->
    <div class="mb-6">
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Zoom</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <!-- Zoom mode -->
        <div class="px-5 py-4 bg-card">
          <div class="mb-3">
            <p class="text-sm font-medium text-foreground">Default fit</p>
            <p class="text-xs text-muted-foreground mt-0.5">How pages are scaled when a PDF is opened</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="opt in [
                { id: 'fit-page' as const, label: 'Fit Page' },
                { id: 'fit-width' as const, label: 'Fit Width' },
                { id: 'custom' as const, label: 'Custom' },
              ]"
              :key="opt.id"
              class="h-8 px-3 text-xs border-2 transition-colors font-medium rounded-md"
              :class="
                effective.zoomMode === opt.id
                  ? 'border-primary text-primary bg-primary/8'
                  : 'border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
              "
              @click="update({ zoomMode: opt.id })"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>

        <!-- Custom scale (only shown when zoomMode is custom) -->
        <div v-if="showZoom" class="px-5 py-4 bg-card">
          <div class="flex items-center justify-between mb-3">
            <div>
              <p class="text-sm font-medium text-foreground">Zoom level</p>
              <p class="text-xs text-muted-foreground mt-0.5">Scale factor for custom zoom mode</p>
            </div>
            <span class="text-sm font-medium tabular-nums text-foreground">{{ Math.round(effective.customScale * 100) }}%</span>
          </div>
          <input
            type="range"
            min="0.25"
            max="4"
            step="0.05"
            class="w-full accent-primary cursor-pointer"
            :value="effective.customScale"
            @input="update({ customScale: Number(($event.target as HTMLInputElement).value) })"
          />
        </div>
      </div>
    </div>
  </div>
</template>
