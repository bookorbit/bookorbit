<script setup lang="ts">
import { computed } from 'vue'
import { usePage } from '@embedpdf/vue/runtime'
import type { AnnotationItem } from '@bookorbit/types'
import { buildHighlightMarks, HIGHLIGHT_OPACITY } from '../lib/pdf-annotation-render'

const props = defineProps<{ annotations: AnnotationItem[] }>()

const page = usePage()

const marks = computed(() => props.annotations.filter((annotation) => annotation.pdf?.page === page.value.pageIndex).flatMap(buildHighlightMarks))

// The layer rides the page's turn, so it only scales: one viewBox in PDF points maps every mark.
const viewBox = computed(() => {
  const { contentWidth, contentHeight, viewScale } = page.value.transform
  return `0 0 ${contentWidth / viewScale} ${contentHeight / viewScale}`
})
</script>

<template>
  <svg
    v-if="marks.length > 0"
    class="pointer-events-none absolute inset-0 size-full"
    :viewBox="viewBox"
    preserveAspectRatio="none"
    aria-hidden="true"
    data-testid="pdf-highlight-layer"
  >
    <template v-for="mark in marks" :key="mark.key">
      <rect
        v-if="mark.kind === 'fill'"
        :x="mark.x"
        :y="mark.y"
        :width="mark.width"
        :height="mark.height"
        :fill="mark.color"
        :fill-opacity="HIGHLIGHT_OPACITY"
        class="mix-blend-multiply"
      />
      <line
        v-else-if="mark.kind === 'line'"
        :x1="mark.x1"
        :y1="mark.y1"
        :x2="mark.x2"
        :y2="mark.y2"
        :stroke="mark.color"
        :stroke-width="mark.thickness"
      />
      <path v-else :d="mark.path" fill="none" :stroke="mark.color" :stroke-width="mark.thickness" stroke-linejoin="round" />
    </template>
  </svg>
</template>
