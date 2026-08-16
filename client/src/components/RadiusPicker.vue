<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const themeStore = useThemeStore()
const { t } = useI18n()
const props = withDefaults(defineProps<{ touch?: boolean }>(), {
  touch: false,
})

const shapes = [
  { id: 'sharp' as const, rx: '0', labelKey: 'components.radiusPicker.sharp' },
  { id: 'default' as const, rx: '3', labelKey: 'components.radiusPicker.default' },
  { id: 'rounded' as const, rx: '8', labelKey: 'components.radiusPicker.rounded' },
  { id: 'pill' as const, rx: '99', labelKey: 'components.radiusPicker.pill' },
]
</script>

<template>
  <div v-if="props.touch" class="grid grid-cols-4 gap-1.5">
    <Tooltip v-for="s in shapes" :key="s.id">
      <TooltipTrigger as-child>
        <button
          type="button"
          class="flex h-9 items-center justify-center rounded-md border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="themeStore.radius === s.id ? 'border-primary bg-primary/8 text-primary' : 'border-border bg-muted/30 text-muted-foreground'"
          :aria-label="t(s.labelKey)"
          @click="themeStore.setRadius(s.id)"
        >
          <span class="block h-4 w-8 border-2 border-current" :style="{ borderRadius: `${s.rx}px` }" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{{ t(s.labelKey) }}</TooltipContent>
    </Tooltip>
  </div>
  <div v-else class="flex items-center gap-1.5">
    <Tooltip v-for="s in shapes" :key="s.id">
      <TooltipTrigger as-child>
        <button
          type="button"
          class="w-8 h-5 border-2 transition-colors focus:outline-none"
          :style="{
            borderRadius: `${s.rx}px`,
            borderColor: themeStore.radius === s.id ? 'var(--primary)' : 'var(--muted-foreground)',
            opacity: themeStore.radius === s.id ? '1' : '0.5',
          }"
          :aria-label="t(s.labelKey)"
          @click="themeStore.setRadius(s.id)"
        />
      </TooltipTrigger>
      <TooltipContent>{{ t(s.labelKey) }}</TooltipContent>
    </Tooltip>
  </div>
</template>
