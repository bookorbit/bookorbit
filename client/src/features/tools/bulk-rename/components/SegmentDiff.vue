<script setup lang="ts">
import { computed } from 'vue'

import type { DiffOp } from '../utils/pathDiff'

/**
 * Character runs of one path segment. Removed text is struck, added text is highlighted, and
 * runs of spaces become middle dots because a doubled space is otherwise an invisible rename.
 * The dots inherit the surrounding diff colour rather than being faded, so they stay legible in
 * both themes; the glyph itself is already lighter than the characters around it.
 */
const props = defineProps<{
  ops: DiffOp[]
  /** `both` interleaves the edit in place; `from` and `to` render one side of it. */
  side?: 'both' | 'from' | 'to'
}>()

interface Piece {
  kind: DiffOp['kind']
  /** Split into plain text and whitespace runs so spaces can be shown without a v-html. */
  parts: { text: string; whitespace: boolean }[]
}

const visible = computed<Piece[]>(() => {
  const side = props.side ?? 'both'
  const keep = side === 'from' ? 'del' : side === 'to' ? 'ins' : null

  return props.ops
    .filter((op) => op.kind === 'eq' || keep === null || op.kind === keep)
    .map((op) => ({
      kind: op.kind,
      parts: op.value
        .split(/( {2,})/)
        .filter(Boolean)
        .map((text) => ({ text, whitespace: /^ {2,}$/.test(text) })),
    }))
})

function dots(text: string): string {
  return '·'.repeat(text.length)
}
</script>

<template>
  <span class="wrap-anywhere font-mono">
    <span
      v-for="(piece, index) in visible"
      :key="index"
      :class="{
        'rounded-[3px] bg-diff-del/15 px-px text-diff-del line-through decoration-diff-del/60 shadow-[inset_0_0_0_1px_var(--diff-del-line)]':
          piece.kind === 'del',
        'rounded-[3px] bg-diff-ins/15 px-px font-semibold text-diff-ins shadow-[inset_0_0_0_1px_var(--diff-ins-line)]': piece.kind === 'ins',
      }"
    >
      <template v-for="(part, partIndex) in piece.parts" :key="partIndex">
        <span v-if="part.whitespace">{{ dots(part.text) }}</span>
        <template v-else>{{ part.text }}</template>
      </template>
    </span>
  </span>
</template>
