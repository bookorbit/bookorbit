<script setup lang="ts">
import { computed } from 'vue'
import { Shuffle } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const props = defineProps<{
  /** Icon only, for the dense desktop toolbar. */
  compact?: boolean
  /** Hide below the `sm` breakpoint, where the mobile control sheet carries its own copy. */
  desktopOnly?: boolean
}>()
const emit = defineEmits<{ shuffle: [] }>()

const { t } = useI18n()

const visibility = computed(() => (props.desktopOnly ? 'hidden sm:flex' : 'flex'))

function handleShuffle() {
  emit('shuffle')
}
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <button
        type="button"
        :aria-label="t('views.bookView.shuffleAria')"
        class="h-8 items-center justify-center gap-1.5 rounded-md border border-input bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:text-foreground"
        :class="[visibility, compact ? 'w-8' : 'px-2.5 text-sm']"
        @click="handleShuffle"
      >
        <Shuffle :size="13" />
        <span v-if="!compact">{{ t('views.bookView.shuffle') }}</span>
      </button>
    </TooltipTrigger>
    <TooltipContent>{{ t('views.bookView.shuffleHint') }}</TooltipContent>
  </Tooltip>
</template>
