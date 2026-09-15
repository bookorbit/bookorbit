<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { IndexerColor } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { sourceDotClass } from '@/features/book-requests/sourceColors'
import SourceColorPicker from './SourceColorPicker.vue'

defineProps<{
  sourceId: number
  sourceName: string
  color: IndexerColor | null
  busy?: boolean
}>()

const emit = defineEmits<{ change: [color: IndexerColor | null] }>()
const { t } = useI18n()
const open = ref(false)

function handleChange(color: IndexerColor | null) {
  open.value = false
  emit('change', color)
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        size="icon-sm"
        variant="ghost"
        class="size-8 shrink-0"
        :disabled="busy"
        :aria-label="t('settings.system.requests.managers.changeColor', { name: sourceName })"
      >
        <span class="size-2.5 rounded-full ring-1 ring-border" :class="sourceDotClass(color)" aria-hidden="true"></span>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" class="w-80 max-w-[calc(100vw-2rem)] p-4">
      <SourceColorPicker
        :model-value="color"
        :input-name="`managed-source-color-${sourceId}`"
        :label="t('settings.system.requests.managers.sourceColor')"
        :hint="t('settings.system.requests.managers.sourceColorHint', { name: sourceName })"
        @update:model-value="handleChange"
      />
    </PopoverContent>
  </Popover>
</template>
