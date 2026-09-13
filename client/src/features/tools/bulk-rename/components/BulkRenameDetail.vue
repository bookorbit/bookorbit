<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowRight, ChevronLeft, ChevronRight, ExternalLink, Eye, EyeOff, Minus, Play, Plus, ShieldAlert, Undo2 } from '@lucide/vue'
import type { BulkRenamePreviewItem } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import BulkRenameStatusBadge from './BulkRenameStatusBadge.vue'
import PathDiffLine from './PathDiffLine.vue'
import PathTree from './PathTree.vue'
import SegmentDiff from './SegmentDiff.vue'
import { explainChange } from '../utils/changeKind'
import type { ChangeKind } from '../utils/changeKind'

const props = defineProps<{
  item: BulkRenamePreviewItem | null
  kind: ChangeKind | null
  pattern: string
  siblings: BulkRenamePreviewItem[]
  index: number
  total: number
  selected: boolean
  runnableCount: number
  /** Absolute paths, shown when the reviewer asks to see the library folders. */
  fullCurrentPath: string | null
  fullNewPath: string | null
  showFullPaths: boolean
}>()

const emit = defineEmits<{
  step: [delta: number]
  select: [bookId: number]
  'toggle-selected': []
  apply: []
  back: []
  'update:show-full-paths': [value: boolean]
}>()

const { t } = useI18n()

const SIBLING_LIMIT = 8

const reasons = computed(() => {
  const item = props.item
  if (!item?.newPath || !props.pattern) return []
  return explainChange(item.currentPath, item.newPath, props.pattern)
})

/**
 * The tree can show the library-relative path or the absolute one. Relative is the default
 * because the library root repeats on every row and pushes the part that differs off the line.
 */
const treePaths = computed(() => {
  if (props.showFullPaths && props.fullCurrentPath && props.fullNewPath) {
    return { from: props.fullCurrentPath, to: props.fullNewPath }
  }
  return { from: props.item?.currentPath ?? '', to: props.item?.newPath ?? '' }
})

const canShowFullPaths = computed(() => Boolean(props.fullCurrentPath && props.fullCurrentPath !== props.item?.currentPath))

const shownSiblings = computed(() => props.siblings.slice(0, SIBLING_LIMIT))
const hiddenSiblings = computed(() => Math.max(0, props.siblings.length - SIBLING_LIMIT))

function levelLabel(reason: (typeof reasons.value)[number]): string {
  if (reason.level === 'removed') return t('tools.bulkRename.detail.levelRemoved')
  if (reason.level === 'filename') return t('tools.bulkRename.detail.levelFilename')
  if (reason.level === 'top') return t('tools.bulkRename.detail.levelTop')
  return t('tools.bulkRename.detail.levelFolder', { depth: reason.depth })
}

/** The pattern segment split so its `{tokens}` can be highlighted without a v-html. */
function patternParts(source: string): { text: string; token: boolean }[] {
  return source
    .split(/(\{[^}]+\})/)
    .filter(Boolean)
    .map((text) => ({ text, token: text.startsWith('{') }))
}

function handleToggleFullPaths(): void {
  emit('update:show-full-paths', !props.showFullPaths)
}

function handleBack(): void {
  emit('back')
}

function handleToggleSelected(): void {
  emit('toggle-selected')
}

function handleApply(): void {
  emit('apply')
}

function handlePrevious(): void {
  emit('step', -1)
}

function handleNext(): void {
  emit('step', 1)
}
</script>

<template>
  <div v-if="!item" class="flex min-h-0 flex-col items-center justify-center gap-3 p-10 text-center">
    <p class="text-base font-semibold">{{ t('tools.bulkRename.empty.noneTitle') }}</p>
    <p class="max-w-sm text-sm text-muted-foreground">{{ t('tools.bulkRename.empty.noneDescription') }}</p>
  </div>

  <div v-else class="flex min-h-0 min-w-0 flex-col">
    <div class="flex flex-none items-start gap-3 border-b border-border px-5 py-3.5">
      <Button variant="ghost" size="icon" class="md:hidden" :aria-label="t('tools.bulkRename.review.back')" @click="handleBack">
        <ChevronLeft class="size-4.5" aria-hidden="true" />
      </Button>

      <div class="min-w-0 flex-1">
        <h2 class="font-serif text-xl leading-7 font-semibold tracking-tight">{{ item.title }}</h2>
        <p class="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <BulkRenameStatusBadge :status="item.status" />
          <span v-if="kind">{{ t(`tools.bulkRename.changeKind.${kind.key}`) }}</span>
          <span v-if="!selected" class="font-semibold text-warning">{{ t('tools.bulkRename.review.excluded') }}</span>
        </p>
      </div>

      <Button as="router-link" :to="{ name: 'book-detail', params: { bookId: item.bookId } }" variant="outline">
        <ExternalLink class="size-3.5" aria-hidden="true" />
        <span class="hidden sm:inline">{{ t('tools.bulkRename.openBook') }}</span>
      </Button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-6">
      <div
        v-if="item.status === 'collision'"
        class="mb-4 flex items-start gap-2.5 rounded-md border border-warning/28 bg-warning/10 px-3.5 py-2.5 text-sm text-warning"
      >
        <ShieldAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>
          <strong class="font-semibold">{{ t('tools.bulkRename.detail.conflictTitle') }}</strong>
          {{ t('tools.bulkRename.detail.conflictBody') }}
        </p>
      </div>

      <section>
        <h3 class="mb-2 text-[0.6875rem] font-bold tracking-wider text-muted-foreground uppercase">
          {{ t('tools.bulkRename.detail.whatChanges') }}
        </h3>
        <div class="rounded-md border border-border bg-background px-3 py-2.5">
          <PathDiffLine :from="item.currentPath" :to="item.newPath" />
        </div>
      </section>

      <section v-if="item.newPath" class="mt-4.5">
        <div class="mb-2 flex flex-wrap items-center gap-2">
          <h3 class="text-[0.6875rem] font-bold tracking-wider text-muted-foreground uppercase">
            {{ t('tools.bulkRename.detail.onDisk') }}
          </h3>
          <button
            v-if="canShowFullPaths"
            class="ms-auto inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            :aria-pressed="showFullPaths"
            @click="handleToggleFullPaths"
          >
            <component :is="showFullPaths ? EyeOff : Eye" class="size-3.5" aria-hidden="true" />
            {{ showFullPaths ? t('tools.bulkRename.detail.hideLibraryFolders') : t('tools.bulkRename.detail.showLibraryFolders') }}
          </button>
        </div>
        <div class="grid overflow-hidden rounded-md border border-border bg-background md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <PathTree :from="treePaths.from" :to="treePaths.to" side="before">
            <template #label>
              <Minus class="size-3" aria-hidden="true" />
              {{ t('tools.bulkRename.detail.today') }}
            </template>
          </PathTree>
          <div class="hidden place-items-center border-x border-border px-2 text-path-fold md:grid">
            <ArrowRight class="size-4" aria-hidden="true" />
          </div>
          <PathTree :from="treePaths.from" :to="treePaths.to" side="after" class="border-t border-border md:border-t-0">
            <template #label>
              <Plus class="size-3" aria-hidden="true" />
              {{ t('tools.bulkRename.detail.afterRename') }}
            </template>
          </PathTree>
        </div>
      </section>

      <section v-if="reasons.length" class="mt-4.5">
        <h3 class="mb-2 text-[0.6875rem] font-bold tracking-wider text-muted-foreground uppercase">
          {{ t('tools.bulkRename.detail.whyItMoves') }}
        </h3>
        <div class="overflow-hidden rounded-md border border-border bg-card">
          <div
            v-for="(reason, reasonIndex) in reasons"
            :key="reasonIndex"
            class="grid gap-1 px-3.5 py-2.5 md:grid-cols-[6rem_minmax(0,1fr)] md:gap-3.5"
            :class="{ 'border-t border-border': reasonIndex > 0 }"
          >
            <div class="text-xs text-muted-foreground">
              <b class="block text-[0.6875rem] font-semibold tracking-wide text-foreground uppercase">{{ levelLabel(reason) }}</b>
              <span v-if="reason.tokens.length">{{ t('tools.bulkRename.detail.tokenCount', { count: reason.tokens.length }) }}</span>
            </div>

            <div class="min-w-0">
              <p v-if="reason.level === 'removed'" class="text-xs leading-relaxed text-muted-foreground">
                {{ t('tools.bulkRename.detail.removedExplainer', { folder: reason.row.from ?? '' }) }}
              </p>
              <template v-else>
                <p v-if="reason.source" class="wrap-anywhere font-mono text-xs text-muted-foreground">
                  <span
                    v-for="(part, partIndex) in patternParts(reason.source)"
                    :key="partIndex"
                    :class="{ 'font-semibold text-primary': part.token }"
                  >
                    {{ part.text }}
                  </span>
                </p>
                <p v-else class="text-xs leading-relaxed text-muted-foreground">
                  {{ t('tools.bulkRename.detail.optionalLevel') }}
                </p>
                <p class="mt-1.5 font-mono text-xs">
                  <SegmentDiff v-if="reason.row.kind === 'edit'" :ops="reason.row.ops ?? []" />
                  <span v-else class="rounded-[3px] bg-diff-ins/15 px-px font-semibold text-diff-ins">{{ reason.row.to }}</span>
                </p>
              </template>
            </div>
          </div>
        </div>
      </section>

      <section v-if="siblings.length" class="mt-4.5">
        <h3 class="mb-2 text-[0.6875rem] font-bold tracking-wider text-muted-foreground uppercase">
          {{ t('tools.bulkRename.detail.siblings', { count: siblings.length }) }}
        </h3>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="sibling in shownSiblings"
            :key="sibling.bookId"
            class="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card px-2 py-1.5 text-xs transition-colors hover:border-primary/45 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            @click="emit('select', sibling.bookId)"
          >
            <ArrowRight class="size-3 shrink-0" aria-hidden="true" />
            <span class="truncate">{{ sibling.title }}</span>
          </button>
          <span v-if="hiddenSiblings" class="inline-flex items-center rounded-full border border-border px-2 py-1.5 text-xs text-muted-foreground">
            {{ t('tools.bulkRename.detail.siblingsMore', { count: hiddenSiblings }) }}
          </span>
        </div>
      </section>
    </div>

    <div class="flex flex-none flex-wrap items-center gap-2.5 border-t border-border bg-card/80 px-5 py-2.5 backdrop-blur-sm">
      <span class="text-sm text-muted-foreground tabular-nums max-md:order-first max-md:basis-full">
        {{ t('tools.bulkRename.review.position', { index: index + 1, total }) }}
      </span>

      <div class="flex gap-0.5">
        <Button variant="outline" size="icon" :disabled="index <= 0" :aria-label="t('tools.bulkRename.review.previous')" @click="handlePrevious">
          <ChevronLeft class="size-3.5" aria-hidden="true" />
        </Button>
        <Button variant="outline" size="icon" :disabled="index >= total - 1" :aria-label="t('tools.bulkRename.review.next')" @click="handleNext">
          <ChevronRight class="size-3.5" aria-hidden="true" />
        </Button>
      </div>

      <p class="hidden text-xs text-muted-foreground lg:block">
        <kbd class="rounded border border-b-2 border-border bg-background px-1 text-[0.6875rem] font-semibold">↑</kbd>
        <kbd class="ms-0.5 rounded border border-b-2 border-border bg-background px-1 text-[0.6875rem] font-semibold">↓</kbd>
        {{ t('tools.bulkRename.review.keyboardHint') }} ·
        <kbd class="rounded border border-b-2 border-border bg-background px-1 text-[0.6875rem] font-semibold">S</kbd>
        {{ t('tools.bulkRename.review.keyboardSkip') }}
      </p>

      <span class="hidden flex-1 md:block" />

      <Button variant="outline" class="max-md:flex-1" :disabled="item.status !== 'will_rename'" @click="handleToggleSelected">
        <component :is="selected ? EyeOff : Undo2" class="size-3.5" aria-hidden="true" />
        {{ selected ? t('tools.bulkRename.review.skip') : t('tools.bulkRename.review.include') }}
      </Button>

      <Button class="max-md:flex-2" :disabled="runnableCount === 0" @click="handleApply">
        <Play class="size-3.5" aria-hidden="true" />
        {{ t('tools.bulkRename.applyCount', { count: runnableCount }) }}
      </Button>
    </div>
  </div>
</template>
