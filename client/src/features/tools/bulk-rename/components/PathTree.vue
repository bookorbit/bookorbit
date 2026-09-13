<script setup lang="ts">
import { computed, useId } from 'vue'
import { File, Folder } from '@lucide/vue'

import SegmentDiff from './SegmentDiff.vue'
import { diffPath, type PathRow } from '../utils/pathDiff'

/**
 * One side of the before/after comparison, drawn as a folder tree. Seeing the two trees next to
 * each other is what makes a moved folder level unmistakable.
 */
const props = defineProps<{
  from: string
  to: string
  side: 'before' | 'after'
}>()

const labelId = useId()

interface Node {
  row: PathRow
  name: string
  leaf: boolean
  depth: number
  /** `gone` and `new` mark a level that exists on only one side. */
  state: 'same' | 'edited' | 'gone' | 'new'
}

const nodes = computed<Node[]>(() => {
  const rows = diffPath(props.from, props.to).filter((row) => (props.side === 'before' ? row.kind !== 'ins' : row.kind !== 'del'))

  return rows.map((row, index) => ({
    row,
    name: (props.side === 'before' ? row.from : row.to) ?? '',
    leaf: index === rows.length - 1,
    depth: index,
    state: row.kind === 'eq' ? 'same' : row.kind === 'edit' ? 'edited' : props.side === 'before' ? 'gone' : 'new',
  }))
})
</script>

<template>
  <div class="min-w-0 p-3" :class="side === 'before' ? 'bg-diff-del/5' : 'bg-diff-ins/5'">
    <p
      :id="labelId"
      class="mb-2 flex items-center gap-1.5 text-[0.6875rem] font-bold tracking-wider uppercase"
      :class="side === 'before' ? 'text-diff-del' : 'text-diff-ins'"
    >
      <slot name="label" />
    </p>

    <ol class="min-w-0 list-none" :aria-labelledby="labelId">
      <li
        v-for="node in nodes"
        :key="node.depth"
        class="flex min-w-0 items-start gap-1.5 py-0.5 font-mono text-xs leading-snug"
        :class="{
          'text-path-dim': node.state === 'same',
          'text-foreground': node.state === 'edited',
          'font-semibold text-foreground': node.leaf && node.state !== 'gone' && node.state !== 'new',
        }"
        :style="{ paddingInlineStart: `${node.depth * 0.85}rem` }"
      >
        <component
          :is="node.leaf ? File : Folder"
          class="mt-0.5 size-3 shrink-0"
          :class="{
            'text-path-fold': node.state === 'same',
            'text-diff-del': node.state === 'gone',
            'text-diff-ins': node.state === 'new',
            'text-primary': node.leaf && (node.state === 'same' || node.state === 'edited'),
          }"
          aria-hidden="true"
        />

        <SegmentDiff
          v-if="node.state === 'edited'"
          :ops="node.row.ops ?? []"
          :side="side === 'before' ? 'from' : 'to'"
          class="min-w-0 wrap-anywhere"
        />
        <span
          v-else
          class="min-w-0 wrap-anywhere"
          :class="{
            'text-diff-del line-through': node.state === 'gone',
            'text-diff-ins': node.state === 'new',
          }"
        >
          {{ node.name }}
        </span>
      </li>
    </ol>
  </div>
</template>
