<script setup lang="ts">
import { Contrast, Highlighter, Palette, Strikethrough, Underline, Waves } from '@lucide/vue'
import { ANNOTATION_HIGHLIGHT_COLORS } from '@bookorbit/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

defineProps<{ count: number; allVisibleSelected: boolean; showRestyle?: boolean }>()

const emit = defineEmits<{ selectPage: []; clear: []; recolor: [hex: string]; restyle: [style: string] }>()

const COLORS = ANNOTATION_HIGHLIGHT_COLORS
const STYLES = [
  { value: 'highlight', label: 'Highlight', icon: Highlighter },
  { value: 'underline', label: 'Underline', icon: Underline },
  { value: 'strikethrough', label: 'Strike', icon: Strikethrough },
  { value: 'squiggly', label: 'Squiggle', icon: Waves },
  { value: 'invert', label: 'Invert', icon: Contrast },
]

function handleSelectPage() {
  emit('selectPage')
}

function handleClear() {
  emit('clear')
}

function handleRecolor(hex: string) {
  emit('recolor', hex)
}

function handleRestyle(style: string) {
  emit('restyle', style)
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
    <span class="font-medium text-foreground">{{ count }} selected</span>
    <button
      type="button"
      class="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      @click="handleSelectPage"
    >
      {{ allVisibleSelected ? 'Page selected' : 'Select page' }}
    </button>
    <button
      type="button"
      class="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      @click="handleClear"
    >
      Clear
    </button>

    <template v-if="showRestyle">
      <div class="h-5 w-px bg-border" />
      <div class="flex items-center gap-1">
        <Palette :size="13" class="text-muted-foreground" />
        <button
          v-for="color in COLORS"
          :key="color.hex"
          type="button"
          class="h-6 w-6 rounded-full border border-border transition-transform hover:scale-110"
          :style="{ background: color.hex }"
          :title="color.label"
          :aria-label="`Recolor to ${color.label}`"
          @click="handleRecolor(color.hex)"
        />
      </div>
      <div class="flex flex-wrap items-center gap-1">
        <Tooltip v-for="style in STYLES" :key="style.value">
          <TooltipTrigger as-child>
            <button
              type="button"
              class="flex h-7 w-7 items-center justify-center rounded border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              :aria-label="`Restyle to ${style.label}`"
              @click="handleRestyle(style.value)"
            >
              <component :is="style.icon" :size="14" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ style.label }}</TooltipContent>
        </Tooltip>
      </div>
    </template>

    <div class="flex-1" />
    <slot name="trailing" />
  </div>
</template>
