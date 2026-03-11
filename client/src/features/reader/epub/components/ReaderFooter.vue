<script setup lang="ts">
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

defineProps<{
  fraction: number
  sectionIndex: number
  totalSections: number
  sectionFractions: number[]
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
  <footer class="fixed bottom-0 left-0 right-0 h-14 z-50 flex items-center gap-3 px-4 bg-background/90 backdrop-blur-md border-t border-border">
    <Tooltip>
      <TooltipTrigger as-child>
        <button class="viewer-btn" :disabled="sectionIndex === 0" @click="emit('prevSection')">
          <ChevronLeft :size="18" />
        </button>
      </TooltipTrigger>
      <TooltipContent>Previous section</TooltipContent>
    </Tooltip>

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
          accentColor: 'var(--primary)',
          background: `linear-gradient(to right, var(--primary) ${fraction * 100}%, var(--border) ${fraction * 100}%)`,
        }"
      />
      <template v-for="(sf, idx) in sectionFractions" :key="idx">
        <div
          v-if="sf > 0 && sf < 1"
          class="absolute top-1/2 -translate-y-1/2 w-px h-3 pointer-events-none"
          :style="{ left: `${sf * 100}%`, background: 'var(--muted-foreground)' }"
        />
      </template>
    </div>

    <span class="text-xs tabular-nums shrink-0 min-w-[3rem] text-center text-muted-foreground"> {{ Math.round(fraction * 100) }}% </span>

    <Tooltip>
      <TooltipTrigger as-child>
        <button class="viewer-btn" :disabled="totalSections > 0 && sectionIndex >= totalSections - 1" @click="emit('nextSection')">
          <ChevronRight :size="18" />
        </button>
      </TooltipTrigger>
      <TooltipContent>Next section</TooltipContent>
    </Tooltip>
  </footer>
</template>
