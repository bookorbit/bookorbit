<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Circle, Square } from '@lucide/vue'
import type { BookViewMode } from '@/composables/useDisplaySettings'

const { t } = useI18n()

withDefaults(
  defineProps<{
    viewMode: BookViewMode
    coverSize: number
    gridGap: number
    coverShape?: 'square' | 'circle'
    coverSizeMin?: number
    coverSizeMax?: number
    coverSizeStep?: number
    gridGapMin?: number
    gridGapMax?: number
    gridGapStep?: number
  }>(),
  {
    coverSizeMin: 100,
    coverSizeMax: 280,
    coverSizeStep: 10,
    gridGapMin: 4,
    gridGapMax: 40,
    gridGapStep: 4,
  },
)

const emit = defineEmits<{
  'update:coverSize': [value: number]
  'update:gridGap': [value: number]
  'update:coverShape': [value: 'square' | 'circle']
}>()
</script>

<template>
  <div class="space-y-4">
    <p class="text-xs font-semibold text-foreground uppercase tracking-wider">{{ t('components.viewHeader.displayControls.display') }}</p>

    <template v-if="viewMode !== 'table'">
      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <span class="text-xs text-muted-foreground">{{ t('components.viewHeader.displayControls.coverSize') }}</span>
          <span class="text-xs font-medium tabular-nums text-foreground">{{ coverSize }}px</span>
        </div>
        <input
          :value="coverSize"
          @input="emit('update:coverSize', Number(($event.target as HTMLInputElement).value))"
          type="range"
          :min="coverSizeMin"
          :max="coverSizeMax"
          :step="coverSizeStep"
          class="w-full accent-primary cursor-pointer"
        />
      </div>

      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <span class="text-xs text-muted-foreground">{{ t('components.viewHeader.displayControls.gridGap') }}</span>
          <span class="text-xs font-medium tabular-nums text-foreground">{{ gridGap }}px</span>
        </div>
        <input
          :value="gridGap"
          @input="emit('update:gridGap', Number(($event.target as HTMLInputElement).value))"
          type="range"
          :min="gridGapMin"
          :max="gridGapMax"
          :step="gridGapStep"
          class="w-full accent-primary cursor-pointer"
        />
      </div>
    </template>

    <template v-else>
      <slot name="columns">
        <p class="text-xs text-muted-foreground">{{ t('components.viewHeader.displayControls.columnsHint') }}</p>
      </slot>
    </template>

    <div v-if="coverShape !== undefined && viewMode !== 'table'" class="space-y-1.5">
      <span class="text-xs text-muted-foreground">{{ t('components.viewHeader.displayControls.coverShape') }}</span>
      <div class="mt-1.5 flex items-center gap-1">
        <button
          class="flex flex-1 items-center justify-center gap-1.5 rounded-md border py-1.5 text-xs font-medium transition-colors"
          :class="
            coverShape === 'circle'
              ? 'border-primary text-primary bg-primary/8'
              : 'border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40'
          "
          @click="emit('update:coverShape', 'circle')"
        >
          <Circle :size="12" /> {{ t('components.viewHeader.displayControls.circle') }}
        </button>

        <button
          class="flex flex-1 items-center justify-center gap-1.5 rounded-md border py-1.5 text-xs font-medium transition-colors"
          :class="
            coverShape === 'square'
              ? 'border-primary text-primary bg-primary/8'
              : 'border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40'
          "
          @click="emit('update:coverShape', 'square')"
        >
          <Square :size="12" /> {{ t('components.viewHeader.displayControls.square') }}
        </button>
      </div>
    </div>
  </div>
</template>
