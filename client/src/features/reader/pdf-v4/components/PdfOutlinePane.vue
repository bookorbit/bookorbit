<script setup lang="ts">
import { computed } from 'vue'
import { useOutline, useOutlineState } from '@embedpdf/vue/outline'
import { usePageList, type PageRef } from '@embedpdf/vue/runtime'
import PdfOutlineTree from './PdfOutlineTree.vue'
import { flattenOutline, type FlatPdfBookmark } from '../pdf-viewer-utils'

defineProps<{ currentPage: number }>()

const outline = useOutline()
const { items, status } = useOutlineState()
const pages = usePageList()

const pageIndexByObject = computed(() => new Map(pages.value.map((page) => [page.ref.objectNumber, page.index])))
const bookmarks = computed(() => flattenOutline(items.value, pageIndexOf))
const loading = computed(() => status.value === 'idle' || status.value === 'loading')

function pageIndexOf(page: PageRef): number | null {
  return pageIndexByObject.value.get(page.objectNumber) ?? null
}

function handleNavigate(entry: FlatPdfBookmark) {
  try {
    outline.activate(entry.item.ref)
  } catch {
    // The document closed while the outline was open; there is nowhere to go.
  }
}
</script>

<template>
  <PdfOutlineTree :bookmarks="bookmarks" :loading="loading" :current-page="currentPage" @navigate="handleNavigate" />
</template>
