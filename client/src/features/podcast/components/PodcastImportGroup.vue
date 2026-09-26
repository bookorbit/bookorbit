<script setup lang="ts">
import { ref, type HTMLAttributes } from 'vue'
import { ChevronDown, ChevronRight } from '@lucide/vue'
import { formatNumber } from '@/i18n/formatters'

/** One collapsible findings group in the local-file import report. Rows come from the default slot. */
const props = withDefaults(
  defineProps<{
    id: string
    label: string
    count: number
    defaultExpanded?: boolean
    listClass?: HTMLAttributes['class']
  }>(),
  { defaultExpanded: false, listClass: 'space-y-2' },
)

const expanded = ref(props.defaultExpanded)

function toggle() {
  expanded.value = !expanded.value
}
</script>

<template>
  <section class="space-y-2">
    <button
      type="button"
      class="flex w-full items-center gap-1.5 text-start text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      :aria-expanded="expanded"
      :aria-controls="`podcast-import-${id}`"
      @click="toggle"
    >
      <ChevronDown v-if="expanded" :size="14" />
      <ChevronRight v-else :size="14" />
      {{ label }} ({{ formatNumber(count) }})
    </button>
    <ul v-show="expanded" :id="`podcast-import-${id}`" :class="listClass">
      <slot />
    </ul>
  </section>
</template>
