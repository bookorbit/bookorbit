<script setup lang="ts">
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'

const props = defineProps<{
  fraction: number
  sectionIndex: number
  totalSections: number
  sectionFractions: number[]
  bgColor: string
  fgColor: string
}>()

const emit = defineEmits<{
  prevSection: []
  nextSection: []
  seek: [fraction: number]
}>()

function onSeek(e: Event) {
  const input = e.target as HTMLInputElement
  emit('seek', Number(input.value))
}
</script>

<template>
  <footer
    class="fixed bottom-0 left-0 right-0 h-14 z-50 flex items-center gap-3 px-4"
    :style="{
      background: `color-mix(in srgb, ${bgColor} 92%, transparent)`,
      color: fgColor,
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      borderTop: `1px solid color-mix(in srgb, ${fgColor} 12%, transparent)`,
    }"
  >
    <button
      class="flex items-center justify-center w-8 h-8 rounded-md transition-opacity hover:opacity-70 disabled:opacity-30 shrink-0"
      :style="{ color: fgColor }"
      :disabled="sectionIndex === 0"
      @click="emit('prevSection')"
      title="Previous section"
    >
      <ChevronLeft :size="18" />
    </button>

    <div class="relative flex-1 flex items-center h-6">
      <input
        type="range"
        min="0"
        max="1"
        step="0.001"
        :value="fraction"
        @input="onSeek"
        class="w-full h-1 rounded-full appearance-none cursor-pointer"
        :style="{
          accentColor: fgColor,
          background: `linear-gradient(to right, color-mix(in srgb, ${fgColor} 60%, transparent) ${fraction * 100}%, color-mix(in srgb, ${fgColor} 20%, transparent) ${fraction * 100}%)`,
        }"
      />
      <template v-for="(sf, idx) in sectionFractions" :key="idx">
        <div
          v-if="sf > 0 && sf < 1"
          class="absolute top-1/2 -translate-y-1/2 w-px h-3 pointer-events-none"
          :style="{
            left: `${sf * 100}%`,
            background: `color-mix(in srgb, ${fgColor} 35%, transparent)`,
          }"
        />
      </template>
    </div>

    <span class="text-xs tabular-nums shrink-0 min-w-[3rem] text-center" :style="{ color: `color-mix(in srgb, ${fgColor} 60%, transparent)` }">
      {{ Math.round(fraction * 100) }}%
    </span>

    <button
      class="flex items-center justify-center w-8 h-8 rounded-md transition-opacity hover:opacity-70 disabled:opacity-30 shrink-0"
      :style="{ color: fgColor }"
      :disabled="totalSections > 0 && sectionIndex >= totalSections - 1"
      @click="emit('nextSection')"
      title="Next section"
    >
      <ChevronRight :size="18" />
    </button>
  </footer>
</template>
