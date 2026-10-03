<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUp, FileCode, FileText, GripVertical, Headphones, RotateCcw } from '@lucide/vue'
import type { RegexMetadataConfig } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import RegexMetadataDialog from './RegexMetadataDialog.vue'
import { DEFAULT_FORMAT_PRIORITY, isReadAlongFormatKey, withReadAlongFormatPriority } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import { formatColorVar } from '@/features/book/lib/format-colors'
import { formatKeyCode, formatKeyName } from '@/features/book/lib/book-formats'
import { formatFamilyColor } from '@/features/settings/libraries/lib/library-formats'
import { DEFAULT_METADATA_PRECEDENCE } from '../composables/useLibraryCreator'
import LibraryCreatorCard from './LibraryCreatorCard.vue'

const { t } = useI18n()

/** Without counts there is no way to tell which formats matter, so only the head of the order shows until asked. */
const PREVIEW_ROWS = 6

const props = withDefaults(
  defineProps<{
    metadataPrecedence: string[]
    regexMetadata?: RegexMetadataConfig | null
    libraryId?: number
    formatPriority: string[]
    allowedFormats?: string[]
    formatCounts?: Record<string, number> | null
  }>(),
  { allowedFormats: () => [], formatCounts: null },
)

const emit = defineEmits<{
  'update:regexMetadata': [value: RegexMetadataConfig | null]
  'update:regexOpen': [value: boolean]
  'update:metadataPrecedence': [value: string[]]
  'update:formatPriority': [value: string[]]
}>()

const regexOpen = ref(false)
const showAll = ref(false)
const dragKey = ref<string | null>(null)
const overKey = ref<string | null>(null)

function baseFormat(key: string): string {
  return isReadAlongFormatKey(key) ? 'epub' : key.toLowerCase()
}

const present = computed(() => {
  if (!props.formatCounts) return null
  const held = Object.entries(props.formatCounts)
    .filter(([, count]) => count > 0)
    .map(([format]) => format.toLowerCase())
  return held.length > 0 ? new Set(held) : null
})

const visible = computed(() => {
  if (showAll.value) return props.formatPriority
  if (present.value) return props.formatPriority.filter((key) => present.value!.has(baseFormat(key)))
  return props.formatPriority.slice(0, PREVIEW_ROWS)
})
const hiddenCount = computed(() => props.formatPriority.length - visible.value.length)
const maxCount = computed(() => Math.max(1, ...Object.values(props.formatCounts ?? {})))

interface FormatRow {
  key: string
  code: string
  name: string
  readAlong: boolean
  count: number | null
  imported: boolean
  absent: boolean
}

const rows = computed<FormatRow[]>(() =>
  visible.value.map((key) => {
    const readAlong = isReadAlongFormatKey(key)
    const base = baseFormat(key)
    return {
      key,
      code: formatKeyCode(key),
      name: formatKeyName(key),
      readAlong,
      count: props.formatCounts && !readAlong ? (props.formatCounts[base] ?? 0) : null,
      imported: props.allowedFormats.length === 0 || props.allowedFormats.includes(base),
      absent: present.value !== null && !present.value.has(base),
    }
  }),
)

const sources = computed(() => {
  const known = props.metadataPrecedence.filter((key) => DEFAULT_METADATA_PRECEDENCE.includes(key))
  return [...known, ...DEFAULT_METADATA_PRECEDENCE.filter((key) => !known.includes(key))]
})

function chipStyle(key: string): Record<string, string> {
  const color = formatColorVar(key)
  return { color, backgroundColor: `color-mix(in oklch, ${color} 13%, transparent)` }
}

function barStyle(row: FormatRow): Record<string, string> {
  return { width: `${((row.count ?? 0) / maxCount.value) * 100}%`, backgroundColor: formatFamilyColor(baseFormat(row.key)) }
}

/** Moves among the rows on screen, so a hidden format never swallows a click. */
function move(key: string, direction: -1 | 1) {
  const target = visible.value[visible.value.indexOf(key) + direction]
  if (target) placeRelative(key, target, direction === 1 ? 'after' : 'before')
}

function placeRelative(key: string, target: string, side: 'before' | 'after') {
  const next = props.formatPriority.filter((candidate) => candidate !== key)
  const index = next.indexOf(target)
  if (index === -1) return
  next.splice(side === 'after' ? index + 1 : index, 0, key)
  emit('update:formatPriority', next)
}

function moveUp(key: string) {
  move(key, -1)
}

function moveDown(key: string) {
  move(key, 1)
}

function resetOrder() {
  emit('update:formatPriority', withReadAlongFormatPriority(DEFAULT_FORMAT_PRIORITY))
}

function toggleShowAll() {
  showAll.value = !showAll.value
}

function onDragStart(key: string) {
  dragKey.value = key
}

function onDragEnter(key: string) {
  overKey.value = key
}

function onDrop(key: string) {
  const from = dragKey.value
  dragKey.value = null
  overKey.value = null
  if (!from || from === key) return
  const movingDown = props.formatPriority.indexOf(from) < props.formatPriority.indexOf(key)
  placeRelative(from, key, movingDown ? 'after' : 'before')
}

function onDragEnd() {
  dragKey.value = null
  overKey.value = null
}

function moveSourceUp(key: string) {
  const next = [...sources.value]
  const index = next.indexOf(key)
  if (index <= 0) return
  next.splice(index, 1)
  next.splice(index - 1, 0, key)
  emit('update:metadataPrecedence', next)
}

function moveSourceDown(key: string) {
  const next = [...sources.value]
  const index = next.indexOf(key)
  if (index < 0 || index === next.length - 1) return
  next.splice(index, 1)
  next.splice(index + 1, 0, key)
  emit('update:metadataPrecedence', next)
}

function openRegex() {
  regexOpen.value = true
  emit('update:regexOpen', true)
}
function closeRegex() {
  regexOpen.value = false
  emit('update:regexOpen', false)
}
function applyRegex(config: RegexMetadataConfig | null) {
  emit('update:regexMetadata', config)
  closeRegex()
}

function sourceTitle(source: string) {
  return t(
    source === 'regex'
      ? 'library.creator.metadata.regex.sourceTitle'
      : `library.creator.metadata.source.${source === 'embedded' ? 'embeddedTitle' : 'opfTitle'}`,
  )
}
function sourceHint(source: string) {
  if (source === 'regex') return t(props.regexMetadata ? 'library.creator.metadata.regex.enabledHint' : 'library.creator.metadata.regex.disabledHint')
  return t(`library.creator.metadata.source.${source === 'embedded' ? 'embeddedHint' : 'opfHint'}`)
}
</script>

<template>
  <div class="flex flex-col gap-3.5">
    <LibraryCreatorCard flush :label="t('library.creator.metadata.primary.title')" label-id="primary-file-title">
      <template #meta>
        <button type="button" class="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" @click="resetOrder">
          <RotateCcw :size="12" aria-hidden="true" />
          {{ t('library.creator.metadata.primary.reset') }}
        </button>
      </template>
      <p class="-mt-1 px-4 pb-3 text-xs text-muted-foreground">{{ t('library.creator.metadata.primary.hint') }}</p>

      <ol aria-labelledby="primary-file-title" class="border-t border-border">
        <li
          v-for="(row, index) in rows"
          :key="row.key"
          draggable="true"
          class="flex min-h-11 cursor-grab items-center gap-2.5 border-b border-border px-3 py-1.5 last:border-b-0 active:cursor-grabbing"
          :class="[
            index === 0 ? 'bg-primary/6' : '',
            overKey === row.key && dragKey !== row.key ? 'shadow-[inset_3px_0_0_var(--primary)]' : '',
            dragKey === row.key ? 'opacity-50' : '',
          ]"
          @dragstart="onDragStart(row.key)"
          @dragenter.prevent="onDragEnter(row.key)"
          @dragover.prevent
          @drop="onDrop(row.key)"
          @dragend="onDragEnd"
        >
          <GripVertical :size="14" class="shrink-0 text-muted-foreground" aria-hidden="true" />
          <span class="w-4 shrink-0 text-center text-xs font-bold tabular-nums" :class="index === 0 ? 'text-primary' : 'text-muted-foreground'">
            {{ formatNumber(index + 1) }}
          </span>
          <span class="inline-flex w-16 shrink-0">
            <span class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tracking-wide" :style="chipStyle(row.key)">
              {{ row.code }}
              <Headphones v-if="row.readAlong" :size="11" :stroke-width="2.5" aria-hidden="true" />
            </span>
          </span>
          <span class="flex min-w-0 flex-1 items-center gap-2">
            <span class="truncate text-[13px]" :class="row.imported ? 'text-foreground' : 'text-muted-foreground line-through'">{{ row.name }}</span>
            <span v-if="index === 0" class="shrink-0 rounded-full bg-primary/14 px-1.5 py-px text-[10.5px] font-medium text-primary">
              {{ t('library.creator.metadata.primary.first') }}
            </span>
            <span v-if="!row.imported" class="shrink-0 text-[11px] text-muted-foreground">{{
              t('library.creator.metadata.primary.notImported')
            }}</span>
          </span>
          <span v-if="formatCounts" class="hidden w-36 shrink-0 items-center gap-2 @lg:flex">
            <span class="h-1 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <span v-if="row.count" class="block h-full rounded-full" :style="barStyle(row)" />
            </span>
            <span class="w-10 text-end text-xs tabular-nums" :class="row.count ? 'text-foreground' : 'text-muted-foreground'">
              {{ row.count === null ? '' : row.count ? formatNumber(row.count) : '–' }}
            </span>
          </span>
          <span class="flex shrink-0">
            <button
              type="button"
              class="flex size-7 items-center justify-center rounded-md text-foreground hover:bg-muted disabled:opacity-30"
              :disabled="index === 0"
              :aria-label="t('library.creator.metadata.moveUp', { item: row.name })"
              @click="moveUp(row.key)"
            >
              <ArrowUp :size="13" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="flex size-7 items-center justify-center rounded-md text-foreground hover:bg-muted disabled:opacity-30"
              :disabled="index === rows.length - 1"
              :aria-label="t('library.creator.metadata.moveDown', { item: row.name })"
              @click="moveDown(row.key)"
            >
              <ArrowDown :size="13" aria-hidden="true" />
            </button>
          </span>
        </li>
      </ol>

      <div v-if="hiddenCount > 0 || showAll" class="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-dashed border-border px-4 py-2.5">
        <p class="text-xs text-muted-foreground">
          <template v-if="showAll">{{ t('library.creator.metadata.primary.showingAll') }}</template>
          <template v-else-if="present">{{ t('library.creator.metadata.primary.notHeld', { count: hiddenCount }) }}</template>
          <template v-else>{{ t('library.creator.metadata.primary.moreBelow', { count: hiddenCount }) }}</template>
        </p>
        <button type="button" class="ms-auto text-xs font-medium text-primary hover:underline" :aria-expanded="showAll" @click="toggleShowAll">
          {{
            showAll
              ? t('library.creator.metadata.primary.showFewer')
              : t('library.creator.metadata.primary.showAll', { count: formatPriority.length })
          }}
        </button>
      </div>
    </LibraryCreatorCard>

    <LibraryCreatorCard :label="t('library.creator.metadata.source.title')" label-id="metadata-source-title">
      <ol aria-labelledby="metadata-source-title" class="flex flex-col gap-2">
        <li
          v-for="(source, index) in sources"
          :key="source"
          class="flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5"
        >
          <span class="text-xs font-bold text-muted-foreground">{{ formatNumber(index + 1) }}</span>
          <component :is="source === 'embedded' ? FileText : FileCode" :size="16" class="shrink-0" aria-hidden="true" />
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-semibold">{{ sourceTitle(source) }}</span>
            <span class="block text-xs text-muted-foreground">{{ sourceHint(source) }}</span>
          </span>
          <Button v-if="source === 'regex'" variant="outline" size="sm" @click="openRegex">{{
            t('library.creator.metadata.regex.configure')
          }}</Button>
          <div class="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              :disabled="index === 0"
              :aria-label="t('library.creator.metadata.regex.moveSourceUp', { source: sourceTitle(source) })"
              @click="moveSourceUp(source)"
              ><ArrowUp
            /></Button>
            <Button
              variant="ghost"
              size="icon"
              :disabled="index === sources.length - 1"
              :aria-label="t('library.creator.metadata.regex.moveSourceDown', { source: sourceTitle(source) })"
              @click="moveSourceDown(source)"
              ><ArrowDown
            /></Button>
          </div>
        </li>
      </ol>
      <p class="mt-2.5 text-xs text-muted-foreground">{{ t('library.creator.metadata.regex.precedenceHint') }}</p>
    </LibraryCreatorCard>
    <RegexMetadataDialog v-if="regexOpen" :config="regexMetadata ?? null" :library-id="libraryId" @close="closeRegex" @apply="applyRegex" />
  </div>
</template>
