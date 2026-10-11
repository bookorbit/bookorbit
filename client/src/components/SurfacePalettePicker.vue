<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check } from '@lucide/vue'
import { SURFACE_PALETTES, type SurfacePaletteOption } from '@/lib/theme-styles'
import { useThemeStore } from '@/stores/theme'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const { t } = useI18n()
const themeStore = useThemeStore()
const props = withDefaults(defineProps<{ touch?: boolean }>(), {
  touch: false,
})

const selectedLabel = computed(() => {
  const selected = SURFACE_PALETTES.find((palette) => palette.id === themeStore.surfacePalette)
  return selected ? t(selected.labelKey) : ''
})

function selectPalette(palette: SurfacePaletteOption) {
  themeStore.setSurfacePalette(palette.id)
}
</script>

<template>
  <div class="w-full space-y-2">
    <!-- Darkest greys first, tinted grounds last; each tile is the palette's real ground, card and edge. -->
    <div class="grid grid-cols-6" :class="props.touch ? 'gap-2.5' : 'gap-2'">
      <Tooltip v-for="palette in SURFACE_PALETTES" :key="palette.id">
        <TooltipTrigger as-child>
          <button
            type="button"
            :data-surface="palette.id"
            class="surface-tile aspect-[4/3] w-full rounded-md outline-offset-2 transition-[outline-color] focus-visible:ring-2 focus-visible:ring-ring"
            :class="themeStore.surfacePalette === palette.id ? 'outline-2 outline-primary' : 'outline-2 outline-transparent hover:outline-border'"
            :aria-label="t(palette.labelKey)"
            :aria-pressed="themeStore.surfacePalette === palette.id"
            @click="selectPalette(palette)"
          >
            <span
              v-if="themeStore.surfacePalette === palette.id"
              class="absolute top-0.5 left-0.5 z-10 flex size-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground"
              aria-hidden="true"
            >
              <Check :size="10" :stroke-width="3" />
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ t(palette.labelKey) }}</TooltipContent>
      </Tooltip>
    </div>
    <p class="text-xs text-muted-foreground" aria-live="polite">{{ selectedLabel }}</p>
  </div>
</template>
