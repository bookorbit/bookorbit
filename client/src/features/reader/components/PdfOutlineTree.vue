<script setup lang="ts">
import { ChevronDown, ChevronRight } from 'lucide-vue-next'
import type { OutlineItem } from '../composables/usePdfOutline'

defineProps<{
  items: OutlineItem[]
  depth: number
}>()

const emit = defineEmits<{
  goToPage: [page: number]
}>()

function toggle(item: OutlineItem) {
  item.expanded = !item.expanded
}
</script>

<template>
  <div>
    <div v-for="(item, i) in items" :key="i">
      <div
        class="flex items-start gap-1 py-1 pr-2 rounded cursor-pointer hover:bg-white/8 transition-colors text-xs text-white/70 hover:text-white"
        :style="{ paddingLeft: (8 + depth * 12) + 'px' }"
        @click="item.pageNum ? emit('goToPage', item.pageNum) : toggle(item)"
      >
        <button
          v-if="item.items.length"
          class="shrink-0 mt-0.5 text-white/30 hover:text-white/70"
          @click.stop="toggle(item)"
        >
          <ChevronDown v-if="item.expanded" :size="11" />
          <ChevronRight v-else :size="11" />
        </button>
        <span v-else class="w-2.75 shrink-0" />
        <span class="leading-relaxed line-clamp-2">{{ item.title }}</span>
        <span v-if="item.pageNum" class="ml-auto shrink-0 text-white/30 tabular-nums">{{ item.pageNum }}</span>
      </div>
      <PdfOutlineTree
        v-if="item.expanded && item.items.length"
        :items="item.items"
        :depth="depth + 1"
        @go-to-page="emit('goToPage', $event)"
      />
    </div>
  </div>
</template>
