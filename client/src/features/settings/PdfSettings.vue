<script setup lang="ts">
import { ref } from 'vue'

const defaultZoom = ref('fit-width')
const defaultScroll = ref<'continuous' | 'page'>('continuous')
const defaultSpread = ref<'none' | 'odd'>('none')
const invertColors = ref(false)
const rememberPosition = ref(true)

const zoomOptions = [
  { id: 'fit-width', label: 'Fit Width' },
  { id: 'fit-page', label: 'Fit Page' },
  { id: '0.75', label: '75%' },
  { id: '1', label: '100%' },
  { id: '1.25', label: '125%' },
  { id: '1.5', label: '150%' },
]
</script>

<template>
  <div class="px-5 py-6 sm:px-10 sm:py-8 max-w-3xl">
    <div class="mb-8">
      <h2 class="font-serif font-semibold text-foreground text-2xl tracking-tight">PDF Reader</h2>
      <p class="mt-1 text-sm text-muted-foreground">Default settings applied when opening PDF files.</p>
    </div>

    <!-- Zoom -->
    <div class="mb-6">
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Zoom</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <div class="px-5 py-4 bg-card">
          <div class="mb-3">
            <p class="text-sm font-medium text-foreground">Default zoom level</p>
            <p class="text-xs text-muted-foreground mt-0.5">Starting zoom when a PDF is opened</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="opt in zoomOptions"
              :key="opt.id"
              class="h-8 px-3 text-xs border-2 transition-colors font-medium rounded-md"
              :class="
                defaultZoom === opt.id
                  ? 'border-primary text-primary bg-primary/8'
                  : 'border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
              "
              @click="defaultZoom = opt.id"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Layout -->
    <div class="mb-6">
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Layout</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <div class="flex items-center justify-between px-5 py-4 bg-card">
          <div>
            <p class="text-sm font-medium text-foreground">Scroll mode</p>
            <p class="text-xs text-muted-foreground mt-0.5">Continuous scrolls through pages; Page by Page flips one at a time</p>
          </div>
          <div class="flex items-center gap-1 p-1 rounded-lg border border-border bg-muted/50">
            <button
              class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="defaultScroll === 'continuous' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="defaultScroll = 'continuous'"
            >
              Continuous
            </button>
            <button
              class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="defaultScroll === 'page' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="defaultScroll = 'page'"
            >
              Page by Page
            </button>
          </div>
        </div>

        <div class="flex items-center justify-between px-5 py-4 bg-card">
          <div>
            <p class="text-sm font-medium text-foreground">Page spread</p>
            <p class="text-xs text-muted-foreground mt-0.5">Show one or two pages side by side</p>
          </div>
          <div class="flex items-center gap-1 p-1 rounded-lg border border-border bg-muted/50">
            <button
              class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="defaultSpread === 'none' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="defaultSpread = 'none'"
            >
              Single
            </button>
            <button
              class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="defaultSpread === 'odd' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="defaultSpread = 'odd'"
            >
              Two-Page
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Display -->
    <div class="mb-6">
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Display</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <div class="flex items-center justify-between px-5 py-4 bg-card">
          <div>
            <p class="text-sm font-medium text-foreground">Invert colors</p>
            <p class="text-xs text-muted-foreground mt-0.5">Invert PDF colors for easier reading in dark mode</p>
          </div>
          <button
            class="w-11 h-6 rounded-full transition-colors relative shrink-0"
            :class="invertColors ? 'bg-primary' : 'bg-muted'"
            @click="invertColors = !invertColors"
          >
            <div
              class="absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm"
              :class="invertColors ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
        </div>
      </div>
    </div>

    <!-- Behavior -->
    <div>
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Behavior</p>
      <div class="border border-border rounded-lg overflow-hidden">
        <div class="flex items-center justify-between px-5 py-4 bg-card">
          <div>
            <p class="text-sm font-medium text-foreground">Remember position</p>
            <p class="text-xs text-muted-foreground mt-0.5">Resume from the last page you were on</p>
          </div>
          <button
            class="w-11 h-6 rounded-full transition-colors relative shrink-0"
            :class="rememberPosition ? 'bg-primary' : 'bg-muted'"
            @click="rememberPosition = !rememberPosition"
          >
            <div
              class="absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm"
              :class="rememberPosition ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
        </div>
      </div>
    </div>

    <p class="mt-6 text-xs text-muted-foreground">These defaults will be persisted and applied to new documents in a future update.</p>
  </div>
</template>
