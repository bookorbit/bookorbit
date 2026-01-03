<script setup lang="ts">
import { X } from 'lucide-vue-next'
import type { BgColor, Direction, FitMode, ScrollMode, ViewMode } from '../composables/useCbzSettings'

defineProps<{
  fitMode: FitMode
  viewMode: ViewMode
  scrollMode: ScrollMode
  direction: Direction
  bgColor: BgColor
}>()

const emit = defineEmits<{
  close: []
  'update:fitMode': [v: FitMode]
  'update:viewMode': [v: ViewMode]
  'update:scrollMode': [v: ScrollMode]
  'update:direction': [v: Direction]
  'update:bgColor': [v: BgColor]
}>()

const FIT_OPTIONS: { value: FitMode; label: string }[] = [
  { value: 'fit-page', label: 'Page' },
  { value: 'fit-width', label: 'Width' },
  { value: 'fit-height', label: 'Height' },
  { value: 'actual', label: 'Actual' },
]

const SCROLL_OPTIONS: { value: ScrollMode; label: string }[] = [
  { value: 'paginated', label: 'Paginated' },
  { value: 'infinite', label: 'Infinite Scroll' },
  { value: 'long-strip', label: 'Long Strip' },
]
</script>

<template>
  <div
    class="absolute inset-y-0 right-0 z-50 w-64 overflow-y-auto"
    style="background: rgba(18, 18, 18, 0.97); border-left: 1px solid rgba(255, 255, 255, 0.08)"
    @click.stop
  >
    <div class="flex items-center justify-between p-4 border-b border-white/10">
      <span class="text-sm font-medium text-white">Settings</span>
      <button class="cbz-btn w-7 h-7" @click="emit('close')"><X :size="14" /></button>
    </div>

    <div class="p-4 flex flex-col gap-5">
      <!-- Fit Mode -->
      <div>
        <p class="text-xs text-white/40 mb-2 uppercase tracking-wide">Fit</p>
        <div class="grid grid-cols-2 gap-1">
          <button
            v-for="opt in FIT_OPTIONS"
            :key="opt.value"
            class="setting-btn"
            :class="fitMode === opt.value ? 'active' : ''"
            @click="emit('update:fitMode', opt.value)"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <!-- View Mode -->
      <div>
        <p class="text-xs text-white/40 mb-2 uppercase tracking-wide">View</p>
        <div class="grid grid-cols-2 gap-1">
          <button class="setting-btn" :class="viewMode === 'single' ? 'active' : ''" @click="emit('update:viewMode', 'single')">Single</button>
          <button class="setting-btn" :class="viewMode === 'two-page' ? 'active' : ''" @click="emit('update:viewMode', 'two-page')">Two-Page</button>
        </div>
      </div>

      <!-- Scroll Mode -->
      <div>
        <p class="text-xs text-white/40 mb-2 uppercase tracking-wide">Scroll</p>
        <div class="flex flex-col gap-1">
          <button
            v-for="opt in SCROLL_OPTIONS"
            :key="opt.value"
            class="setting-btn"
            :class="scrollMode === opt.value ? 'active' : ''"
            @click="emit('update:scrollMode', opt.value)"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <!-- Direction -->
      <div>
        <p class="text-xs text-white/40 mb-2 uppercase tracking-wide">Direction</p>
        <div class="grid grid-cols-2 gap-1">
          <button class="setting-btn" :class="direction === 'ltr' ? 'active' : ''" @click="emit('update:direction', 'ltr')">LTR →</button>
          <button class="setting-btn" :class="direction === 'rtl' ? 'active' : ''" @click="emit('update:direction', 'rtl')">← RTL</button>
        </div>
      </div>

      <!-- Background -->
      <div>
        <p class="text-xs text-white/40 mb-2 uppercase tracking-wide">Background</p>
        <div class="grid grid-cols-3 gap-1">
          <button class="setting-btn" :class="bgColor === 'black' ? 'active' : ''" @click="emit('update:bgColor', 'black')">Black</button>
          <button class="setting-btn" :class="bgColor === 'gray' ? 'active' : ''" @click="emit('update:bgColor', 'gray')">Gray</button>
          <button class="setting-btn" :class="bgColor === 'white' ? 'active' : ''" @click="emit('update:bgColor', 'white')">White</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "tailwindcss";
.cbz-btn {
  @apply flex items-center justify-center w-8 h-8 rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors shrink-0;
}
.setting-btn {
  @apply px-2 py-1.5 rounded text-xs text-white/60 hover:text-white hover:bg-white/10 transition-colors text-center;
}
.setting-btn.active {
  @apply bg-blue-500/20 text-blue-400 hover:bg-blue-500/30;
}
</style>
