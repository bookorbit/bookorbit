<script setup lang="ts">
import { ref } from 'vue'
import { Bookmark, BookOpen, ChevronDown, ChevronRight, Highlighter, Trash2, X } from 'lucide-vue-next'
import type { TocItem } from '../composables/useToc'
import type { Bookmark as BookmarkType } from '../composables/useBookmarks'
import type { Annotation } from '../composables/useAnnotations'
import { stripFragment, formatDate } from '../utils'

const props = defineProps<{
  chapters: TocItem[]
  bookmarks: BookmarkType[]
  annotations: Annotation[]
  activeHref: string
  expandedHrefs: Set<string>
}>()

const emit = defineEmits<{
  close: []
  navigateChapter: [href: string]
  deleteBookmark: [id: number]
  deleteAnnotation: [id: number]
  toggleExpand: [href: string]
}>()

type Tab = 'chapters' | 'bookmarks' | 'highlights'
const activeTab = ref<Tab>('chapters')

function isActive(href: string) {
  return stripFragment(props.activeHref) === stripFragment(href)
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex">
    <div class="w-80 h-full bg-card text-card-foreground flex flex-col shadow-2xl border-r border-border" @click.stop>
      <div class="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div class="flex gap-1">
          <button
            v-for="tab in [
              { id: 'chapters', icon: BookOpen, label: 'Chapters' },
              { id: 'bookmarks', icon: Bookmark, label: 'Bookmarks' },
              { id: 'highlights', icon: Highlighter, label: 'Highlights' },
            ] as const"
            :key="tab.id"
            class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors"
            :class="activeTab === tab.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'"
            @click="activeTab = tab.id"
          >
            <component :is="tab.icon" :size="13" />
            {{ tab.label }}
          </button>
        </div>
        <button
          class="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          @click="emit('close')"
        >
          <X :size="16" />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto">
        <template v-if="activeTab === 'chapters'">
          <TocList
            :items="chapters"
            :activeHref="activeHref"
            :expandedHrefs="expandedHrefs"
            :depth="0"
            @navigate="emit('navigateChapter', $event)"
            @toggleExpand="emit('toggleExpand', $event)"
          />
          <div v-if="chapters.length === 0" class="px-4 py-8 text-center text-sm text-muted-foreground">No chapters found</div>
        </template>

        <template v-if="activeTab === 'bookmarks'">
          <div v-if="bookmarks.length === 0" class="px-4 py-8 text-center text-sm text-muted-foreground">No bookmarks yet</div>
          <ul v-else class="divide-y divide-border">
            <li v-for="bm in bookmarks" :key="bm.id" class="flex items-start gap-3 px-4 py-3 hover:bg-muted/50 group">
              <Bookmark :size="14" class="mt-0.5 shrink-0 text-muted-foreground" />
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium leading-snug truncate">{{ bm.title || 'Bookmark' }}</p>
                <p class="text-xs text-muted-foreground mt-0.5">{{ formatDate(bm.createdAt) }}</p>
              </div>
              <button
                class="opacity-0 group-hover:opacity-100 flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-destructive transition-all shrink-0"
                @click="emit('deleteBookmark', bm.id)"
                title="Delete bookmark"
              >
                <Trash2 :size="13" />
              </button>
            </li>
          </ul>
        </template>

        <template v-if="activeTab === 'highlights'">
          <div v-if="annotations.length === 0" class="px-4 py-8 text-center text-sm text-muted-foreground">No highlights yet</div>
          <ul v-else class="divide-y divide-border">
            <li v-for="ann in annotations" :key="ann.id" class="px-4 py-3 hover:bg-muted/50 group">
              <div class="flex items-start gap-2 mb-1">
                <span class="mt-1.5 w-2.5 h-2.5 rounded-full shrink-0" :style="{ background: ann.color }" />
                <p class="text-sm leading-relaxed flex-1 min-w-0">{{ ann.text }}</p>
                <button
                  class="opacity-0 group-hover:opacity-100 flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-destructive transition-all shrink-0"
                  @click="emit('deleteAnnotation', ann.id)"
                  title="Delete highlight"
                >
                  <Trash2 :size="13" />
                </button>
              </div>
              <p v-if="ann.chapterTitle" class="text-xs text-muted-foreground pl-4">{{ ann.chapterTitle }}</p>
              <p v-if="ann.note" class="text-xs text-muted-foreground mt-1 pl-4 italic">{{ ann.note }}</p>
            </li>
          </ul>
        </template>
      </div>
    </div>
    <div class="flex-1" @click="emit('close')" />
  </div>
</template>

<script lang="ts">
import { defineComponent, h } from 'vue'
import { stripFragment } from '../utils'

const TocList = defineComponent({
  name: 'TocList',
  props: {
    items: { type: Array as () => TocItem[], required: true },
    activeHref: { type: String, required: true },
    expandedHrefs: { type: Object as () => Set<string>, required: true },
    depth: { type: Number, default: 0 },
  },
  emits: ['navigate', 'toggleExpand'],
  setup(props, { emit }) {
    function isActive(href: string) {
      return stripFragment(props.activeHref) === stripFragment(href)
    }

    return () =>
      h(
        'ul',
        { class: 'py-1' },
        props.items.map((item) => {
          const hasChildren = item.subitems && item.subitems.length > 0
          const expanded = props.expandedHrefs.has(item.href)
          const active = isActive(item.href)

          return h('li', { key: item.href }, [
            h(
              'button',
              {
                class: [
                  'w-full text-left flex items-center gap-1.5 px-4 py-2 text-sm transition-colors hover:bg-muted/50',
                  active ? 'text-primary font-medium bg-primary/8' : 'text-foreground',
                ],
                style: { paddingLeft: `${16 + props.depth * 12}px` },
                onClick: () => {
                  emit('navigate', item.href)
                },
              },
              [
                hasChildren
                  ? h(
                      'span',
                      {
                        class: 'shrink-0',
                        onClick: (e: Event) => {
                          e.stopPropagation()
                          emit('toggleExpand', item.href)
                        },
                      },
                      [expanded ? h(ChevronDown, { size: 14 }) : h(ChevronRight, { size: 14 })],
                    )
                  : h('span', { class: 'w-3.5 shrink-0' }),
                h('span', { class: 'truncate' }, item.label),
              ],
            ),
            hasChildren && expanded
              ? h(TocList, {
                  items: item.subitems!,
                  activeHref: props.activeHref,
                  expandedHrefs: props.expandedHrefs,
                  depth: props.depth + 1,
                  onNavigate: (href: string) => emit('navigate', href),
                  onToggleExpand: (href: string) => emit('toggleExpand', href),
                })
              : null,
          ])
        }),
      )
  },
})
</script>
