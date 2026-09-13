<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useElementSize } from '@vueuse/core'
import { Search } from '@lucide/vue'
import { RecycleScroller } from 'vue-virtual-scroller'
import { Rotation } from '@embedpdf/models'
import { useDocumentState } from '@embedpdf/core/vue'
import { ThumbImg } from '@embedpdf/plugin-thumbnail/vue'

const props = defineProps<{
  documentId: string
  currentPage: number
  totalPages: number
}>()

const emit = defineEmits<{
  select: [pageIndex: number]
}>()

const { t } = useI18n()

const GAP = 10
const MIN_CELL_WIDTH = 104
const LABEL_HEIGHT = 20
const MAX_COLUMNS = 6
const FALLBACK_ASPECT = 1.414

const documentState = useDocumentState(() => props.documentId)
const scroller = ref<{ scrollToItem: (index: number) => void } | null>(null)
const viewport = ref<HTMLElement | null>(null)
const { width: viewportWidth } = useElementSize(viewport)
const jumpValue = ref('')

const pageAspects = computed(() => {
  const pages = documentState.value?.document?.pages ?? []
  if (pages.length === 0) return Array.from({ length: props.totalPages }, () => FALLBACK_ASPECT)
  return pages.map((page) => {
    const quarterTurned = page.rotation === Rotation.Degree90 || page.rotation === Rotation.Degree270
    const width = quarterTurned ? page.size.height : page.size.width
    const height = quarterTurned ? page.size.width : page.size.height
    return width > 0 ? height / width : FALLBACK_ASPECT
  })
})

const pageCount = computed(() => pageAspects.value.length)

const columns = computed(() => {
  const available = viewportWidth.value - GAP
  if (available <= 0) return 2
  return Math.min(Math.max(Math.floor(available / (MIN_CELL_WIDTH + GAP)), 1), MAX_COLUMNS)
})

const cellWidth = computed(() => {
  const available = viewportWidth.value - GAP * (columns.value + 1)
  return available > 0 ? available / columns.value : MIN_CELL_WIDTH
})

// One row height for every row keeps the list uniformly virtualizable; the tallest
// page in the document sets it and shorter pages are centred inside their cell.
const tallestAspect = computed(() => pageAspects.value.reduce((tallest, aspect) => Math.max(tallest, aspect), FALLBACK_ASPECT))

const rowHeight = computed(() => Math.round(cellWidth.value * tallestAspect.value) + LABEL_HEIGHT + GAP)

const rows = computed(() => {
  const perRow = columns.value
  const result: { id: number; pageIndexes: number[] }[] = []
  for (let start = 0; start < pageCount.value; start += perRow) {
    result.push({
      id: start,
      pageIndexes: Array.from({ length: Math.min(perRow, pageCount.value - start) }, (_, offset) => start + offset),
    })
  }
  return result
})

function cellStyle(pageIndex: number) {
  const aspect = pageAspects.value[pageIndex] ?? FALLBACK_ASPECT
  return {
    width: `${cellWidth.value}px`,
    height: `${Math.round(cellWidth.value * aspect)}px`,
  }
}

function handleSelect(pageIndex: number) {
  emit('select', pageIndex)
}

function handleJump(event: Event) {
  const input = event.target as HTMLInputElement
  const page = Number.parseInt(input.value, 10)
  if (!Number.isFinite(page)) {
    jumpValue.value = ''
    return
  }
  const clamped = Math.min(Math.max(page, 1), pageCount.value || 1)
  jumpValue.value = ''
  input.blur()
  emit('select', clamped - 1)
}

async function revealCurrentPage() {
  await nextTick()
  const rowIndex = Math.floor((props.currentPage - 1) / columns.value)
  if (rowIndex < 0 || !Number.isFinite(rowIndex)) return
  scroller.value?.scrollToItem(rowIndex)
}

watch(
  () => [props.currentPage, columns.value] as const,
  () => void revealCurrentPage(),
  { immediate: true, flush: 'post' },
)
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="shrink-0 border-b border-border p-3">
      <div class="relative">
        <Search :size="15" class="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          v-model="jumpValue"
          type="search"
          inputmode="numeric"
          :placeholder="t('reader.pdf.sidebar.jumpToPage')"
          :aria-label="t('reader.pdf.sidebar.jumpToPage')"
          class="h-9 w-full rounded-md border border-border bg-background ps-9 pe-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
          @change="handleJump"
          @keydown.enter="handleJump"
        />
      </div>
    </div>

    <div ref="viewport" class="min-h-0 flex-1 bg-muted/25">
      <RecycleScroller
        v-if="rows.length > 0 && viewportWidth > 0"
        ref="scroller"
        v-slot="{ item }"
        class="h-full min-w-0 overflow-x-hidden"
        :items="rows"
        :item-size="rowHeight"
        key-field="id"
      >
        <div class="flex" :style="{ gap: `${GAP}px`, paddingInline: `${GAP}px`, paddingBlockEnd: `${GAP}px` }">
          <button
            v-for="pageIndex in item.pageIndexes"
            :key="pageIndex"
            type="button"
            class="flex shrink-0 flex-col items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            :style="{ width: `${cellWidth}px` }"
            :aria-label="t('reader.pdf.sidebar.goToPage', { page: pageIndex + 1 })"
            :aria-current="props.currentPage === pageIndex + 1 ? 'page' : undefined"
            @click="handleSelect(pageIndex)"
          >
            <span
              class="flex items-center justify-center overflow-hidden rounded border-2 bg-background transition-colors"
              :class="
                props.currentPage === pageIndex + 1 ? 'border-primary ring-2 ring-primary/15' : 'border-border hover:border-muted-foreground/50'
              "
              :style="cellStyle(pageIndex)"
            >
              <ThumbImg
                :document-id="props.documentId"
                :meta="{
                  pageIndex,
                  width: cellWidth,
                  height: cellWidth * (pageAspects[pageIndex] ?? 1.414),
                  wrapperHeight: rowHeight,
                  top: 0,
                  labelHeight: 0,
                }"
                class="h-full w-full object-contain"
                alt=""
              />
            </span>
            <span class="text-xs tabular-nums" :class="props.currentPage === pageIndex + 1 ? 'font-semibold text-primary' : 'text-muted-foreground'">
              {{ pageIndex + 1 }}
            </span>
          </button>
        </div>
      </RecycleScroller>
    </div>
  </div>
</template>

<style>
@import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
</style>
