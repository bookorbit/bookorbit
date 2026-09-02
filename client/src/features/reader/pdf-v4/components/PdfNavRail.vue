<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookOpen, FileText, Highlighter, Search } from '@lucide/vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PDF_SIDEBAR_TABS, type PdfSidebarTab } from '../composables/usePdfSidebarLayout'

const props = defineProps<{
  activeTab: PdfSidebarTab
  open: boolean
  highlightCount: number
  tabIds: Record<PdfSidebarTab, string>
  panelIds: Record<PdfSidebarTab, string>
}>()

const emit = defineEmits<{
  select: [tab: PdfSidebarTab]
}>()

const { t } = useI18n()

const railEl = ref<HTMLElement | null>(null)

const TAB_ICONS = {
  thumbnails: FileText,
  contents: BookOpen,
  search: Search,
  highlights: Highlighter,
} as const

const TAB_LABEL_KEYS = {
  thumbnails: 'reader.pdf.sidebar.pages',
  contents: 'reader.pdf.sidebar.contents',
  search: 'reader.pdf.sidebar.search',
  highlights: 'reader.sidebar.tabs.notesShort',
} as const

function label(tab: PdfSidebarTab) {
  return t(TAB_LABEL_KEYS[tab])
}

function handleSelect(tab: PdfSidebarTab) {
  emit('select', tab)
}

function handleKeydown(event: KeyboardEvent) {
  const current = PDF_SIDEBAR_TABS.indexOf(props.activeTab)
  let next: number
  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (current + 1) % PDF_SIDEBAR_TABS.length
  else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (current - 1 + PDF_SIDEBAR_TABS.length) % PDF_SIDEBAR_TABS.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = PDF_SIDEBAR_TABS.length - 1
  else return

  event.preventDefault()
  const nextTab = PDF_SIDEBAR_TABS[next]
  if (!nextTab) return
  emit('select', nextTab)
  void nextTick(() => railEl.value?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus())
}
</script>

<template>
  <div
    ref="railEl"
    role="tablist"
    aria-orientation="vertical"
    :aria-label="t('reader.pdf.sidebar.tabsLabel')"
    class="flex h-full w-14 shrink-0 flex-col items-center gap-1 border-e border-border bg-card py-2"
    @keydown="handleKeydown"
  >
    <Tooltip v-for="tab in PDF_SIDEBAR_TABS" :key="tab">
      <TooltipTrigger as-child>
        <button
          :id="props.tabIds[tab]"
          type="button"
          role="tab"
          :aria-selected="props.open && props.activeTab === tab"
          :aria-controls="props.open ? props.panelIds[tab] : undefined"
          :tabindex="props.activeTab === tab ? 0 : -1"
          :aria-label="label(tab)"
          class="relative flex size-10 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          :class="
            props.open && props.activeTab === tab ? 'bg-primary/15 text-primary' : 'text-foreground hover:bg-muted focus-visible:text-foreground'
          "
          @click="handleSelect(tab)"
        >
          <span v-if="props.open && props.activeTab === tab" aria-hidden="true" class="absolute inset-y-2 -start-2 w-0.5 rounded-e-full bg-primary" />
          <component :is="TAB_ICONS[tab]" :size="19" aria-hidden="true" />
          <span
            v-if="tab === 'highlights' && props.highlightCount > 0"
            aria-hidden="true"
            class="absolute end-0.5 top-0.5 min-w-4 rounded-full bg-primary px-1 text-[9px] font-bold leading-4 text-primary-foreground"
          >
            {{ props.highlightCount > 99 ? '99+' : props.highlightCount }}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{{ label(tab) }}</TooltipContent>
    </Tooltip>
  </div>
</template>
