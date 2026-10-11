<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { RADIUS_OPTIONS, useThemeStore, type RadiusOption } from '@/stores/theme'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const themeStore = useThemeStore()
const { t } = useI18n()
const props = withDefaults(defineProps<{ touch?: boolean }>(), {
  touch: false,
})

function selectRadius(option: RadiusOption) {
  themeStore.setRadius(option.id)
}
</script>

<template>
  <div v-if="props.touch" class="grid grid-cols-4 gap-1.5">
    <Tooltip v-for="option in RADIUS_OPTIONS" :key="option.id">
      <TooltipTrigger as-child>
        <button
          type="button"
          class="flex h-9 items-center justify-center rounded-md border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="themeStore.radius === option.id ? 'border-primary bg-primary/8 text-primary' : 'border-border bg-muted/30 text-muted-foreground'"
          :aria-label="t(option.descriptionKey)"
          :aria-pressed="themeStore.radius === option.id"
          @click="selectRadius(option)"
        >
          <span class="block h-4 w-8 border-2 border-current" :style="{ borderRadius: option.previewRadius }" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{{ t(option.descriptionKey) }}</TooltipContent>
    </Tooltip>
  </div>
  <div v-else class="flex items-center gap-1.5">
    <Tooltip v-for="option in RADIUS_OPTIONS" :key="option.id">
      <TooltipTrigger as-child>
        <button
          type="button"
          class="w-8 h-5 border-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="themeStore.radius === option.id ? 'border-primary' : 'border-muted-foreground opacity-50 hover:opacity-100'"
          :style="{ borderRadius: option.previewRadius }"
          :aria-label="t(option.descriptionKey)"
          :aria-pressed="themeStore.radius === option.id"
          @click="selectRadius(option)"
        />
      </TooltipTrigger>
      <TooltipContent>{{ t(option.descriptionKey) }}</TooltipContent>
    </Tooltip>
  </div>
</template>
