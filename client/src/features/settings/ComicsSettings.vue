<script setup lang="ts">
import { ref } from 'vue'

const scrollMode = ref<'webtoon' | 'paged'>('paged')
const readingDirection = ref<'ltr' | 'rtl'>('ltr')
const background = ref<'black' | 'white' | 'system'>('black')
const fitMode = ref<'width' | 'height' | 'original'>('width')
const rememberPosition = ref(true)
const preloadPages = ref(3)

const backgrounds = [
  { id: 'black', label: 'Black' },
  { id: 'white', label: 'White' },
  { id: 'system', label: 'System' },
]
</script>

<template>
  <div class="px-5 py-6 sm:px-10 sm:py-8 max-w-3xl">
    <div class="mb-8">
      <h2 class="font-serif font-semibold text-foreground text-2xl tracking-tight">Comics Reader</h2>
      <p class="mt-1 text-sm text-muted-foreground">Default settings applied when opening CBZ, CBR, and CB7 files.</p>
    </div>

    <!-- View -->
    <div class="mb-6">
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">View</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <div class="flex items-center justify-between px-5 py-4 bg-card">
          <div>
            <p class="text-sm font-medium text-foreground">Reading mode</p>
            <p class="text-xs text-muted-foreground mt-0.5">Paged flips one page at a time; Webtoon scrolls vertically</p>
          </div>
          <div class="flex items-center gap-1 p-1 rounded-lg border border-border bg-muted/50">
            <button
              class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="scrollMode === 'paged' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="scrollMode = 'paged'"
            >
              Paged
            </button>
            <button
              class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="scrollMode === 'webtoon' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="scrollMode = 'webtoon'"
            >
              Webtoon
            </button>
          </div>
        </div>

        <div class="flex items-center justify-between px-5 py-4 bg-card">
          <div>
            <p class="text-sm font-medium text-foreground">Reading direction</p>
            <p class="text-xs text-muted-foreground mt-0.5">Left-to-right for western; right-to-left for manga</p>
          </div>
          <div class="flex items-center gap-1 p-1 rounded-lg border border-border bg-muted/50">
            <button
              class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="readingDirection === 'ltr' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="readingDirection = 'ltr'"
            >
              L → R
            </button>
            <button
              class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="readingDirection === 'rtl' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="readingDirection = 'rtl'"
            >
              R → L
            </button>
          </div>
        </div>

        <div class="flex items-center justify-between px-5 py-4 bg-card">
          <div>
            <p class="text-sm font-medium text-foreground">Fit mode</p>
            <p class="text-xs text-muted-foreground mt-0.5">How pages are scaled to fit the screen</p>
          </div>
          <div class="flex items-center gap-1.5">
            <button
              v-for="opt in [
                { id: 'width', label: 'Width' },
                { id: 'height', label: 'Height' },
                { id: 'original', label: 'Original' },
              ]"
              :key="opt.id"
              class="h-7 px-3 text-xs border-2 transition-colors font-medium rounded-md"
              :class="
                fitMode === opt.id
                  ? 'border-primary text-primary bg-primary/8'
                  : 'border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
              "
              @click="fitMode = opt.id as 'width' | 'height' | 'original'"
            >
              {{ opt.label }}
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
            <p class="text-sm font-medium text-foreground">Background color</p>
            <p class="text-xs text-muted-foreground mt-0.5">Canvas color behind pages</p>
          </div>
          <div class="flex items-center gap-1.5">
            <button
              v-for="bg in backgrounds"
              :key="bg.id"
              class="h-7 px-3 text-xs border-2 transition-colors font-medium rounded-md"
              :class="
                background === bg.id
                  ? 'border-primary text-primary bg-primary/8'
                  : 'border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
              "
              @click="background = bg.id as 'black' | 'white' | 'system'"
            >
              {{ bg.label }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Performance -->
    <div class="mb-6">
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Performance</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <div class="px-5 py-4 bg-card">
          <div class="flex items-center justify-between mb-3">
            <div>
              <p class="text-sm font-medium text-foreground">Preload pages</p>
              <p class="text-xs text-muted-foreground mt-0.5">Number of pages to load ahead for faster navigation</p>
            </div>
            <span class="text-sm font-medium tabular-nums text-foreground">{{ preloadPages }}</span>
          </div>
          <input v-model.number="preloadPages" type="range" min="1" max="10" step="1" class="w-full accent-primary cursor-pointer" />
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

    <p class="mt-6 text-xs text-muted-foreground">These defaults will be persisted and applied to new comics in a future update.</p>
  </div>
</template>
