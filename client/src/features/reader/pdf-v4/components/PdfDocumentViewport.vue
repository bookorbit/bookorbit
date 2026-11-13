<script setup lang="ts">
import { LinkLayer, type Link } from '@embedpdf/vue/link'
import { RenderLayer } from '@embedpdf/vue/render'
import { SearchLayer } from '@embedpdf/vue/search'
import { SelectionClipboard, SelectionHandles, SelectionLayer } from '@embedpdf/vue/selection'
import { Scrollbar, Stage } from '@embedpdf/vue/stage'
import type { AnnotationItem } from '@bookorbit/types'
import PdfExternalLink from './PdfExternalLink.vue'
import PdfHighlightLayer from './PdfHighlightLayer.vue'
import { safeExternalPdfUrl } from '../pdf-viewer-utils'

defineProps<{ annotations: AnnotationItem[] }>()

const emit = defineEmits<{ externalLink: [url: URL] }>()

defineSlots<{ overlay?(): unknown }>()

function externalUrl(link: Link): URL | null {
  return link.target.kind === 'uri' ? safeExternalPdfUrl(link.target.uri) : null
}

function handleExternalLink(url: URL) {
  emit('externalLink', url)
}
</script>

<template>
  <SelectionClipboard />
  <Stage
    class="size-full bg-muted/40 [--epdf-accent:var(--primary)] [--epdf-scrollbar-thumb:var(--muted-foreground)] [--epdf-search-blend-mode:normal] [--epdf-search-highlight-active:color-mix(in_oklch,var(--primary)_55%,transparent)] [--epdf-search-highlight:color-mix(in_oklch,var(--primary)_30%,transparent)] [--epdf-text-selection:color-mix(in_oklch,var(--primary)_35%,transparent)]"
    data-testid="pdf-stage"
  >
    <template #page>
      <RenderLayer />
      <PdfHighlightLayer :annotations="annotations" />
      <SearchLayer />
      <SelectionLayer />
      <LinkLayer>
        <template #link="{ link, native }">
          <PdfExternalLink v-if="externalUrl(link)" :link="link" :url="externalUrl(link)!" @open="handleExternalLink" />
          <component :is="native" v-else />
        </template>
      </LinkLayer>
    </template>
    <template #overlay>
      <Scrollbar axis="y" class="my-1.5 rounded-full" />
      <Scrollbar axis="x" class="mx-1.5 rounded-full" />
      <SelectionHandles />
      <slot name="overlay" />
    </template>
  </Stage>
</template>
