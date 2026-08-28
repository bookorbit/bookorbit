<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import SegmentDiff from './SegmentDiff.vue'
import { diffPath, type PathRow } from '../utils/pathDiff'

/**
 * A whole path on one line, with only the changed characters marked. Leading folders that never
 * change fold into a single chip so the eye lands on the edit rather than on the library root.
 */
const props = withDefaults(
  defineProps<{
    from: string
    to: string | null
    /** Unchanged leading folders beyond this many collapse into one chip. */
    foldAfter?: number
  }>(),
  { foldAfter: 3 },
)

const { t } = useI18n()

interface Fold {
  type: 'fold'
  count: number
  title: string
}

interface Segment {
  type: 'segment'
  row: PathRow
}

const pieces = computed<(Fold | Segment)[]>(() => {
  if (props.to === null) return []

  const rows = diffPath(props.from, props.to)
  const firstChange = rows.findIndex((row) => row.kind !== 'eq')
  if (firstChange === -1) return rows.map((row) => ({ type: 'segment' as const, row }))

  const hidden = Math.max(0, firstChange - props.foldAfter)
  const out: (Fold | Segment)[] = []
  if (hidden > 0) {
    out.push({
      type: 'fold',
      count: hidden,
      title: rows
        .slice(0, hidden)
        .map((row) => row.from)
        .join('/'),
    })
  }
  for (const row of rows.slice(hidden)) out.push({ type: 'segment', row })
  return out
})
</script>

<template>
  <span class="wrap-anywhere font-mono text-xs leading-relaxed">
    <template v-if="to === null">
      <span class="text-path-dim">{{ from }}</span>
    </template>

    <template v-for="(piece, index) in pieces" v-else :key="index">
      <span v-if="index > 0" class="px-px text-path-fold">/</span>

      <span v-if="piece.type === 'fold'" class="rounded bg-muted px-1.5 text-path-fold" :title="piece.title">
        {{ t('tools.bulkRename.detail.foldedFolders', { count: piece.count }) }}
      </span>

      <span v-else-if="piece.row.kind === 'eq'" class="text-path-dim">{{ piece.row.from }}</span>
      <SegmentDiff v-else-if="piece.row.kind === 'edit'" :ops="piece.row.ops ?? []" />
      <span
        v-else-if="piece.row.kind === 'del'"
        class="rounded-[3px] bg-diff-del/15 px-px text-diff-del line-through decoration-diff-del/60 shadow-[inset_0_0_0_1px_var(--diff-del-line)]"
      >
        {{ piece.row.from }}
      </span>
      <span v-else class="rounded-[3px] bg-diff-ins/15 px-px font-semibold text-diff-ins shadow-[inset_0_0_0_1px_var(--diff-ins-line)]">
        {{ piece.row.to }}
      </span>
    </template>
  </span>
</template>
