<script setup lang="ts">
import type { SetupTable } from '@bookorbit/types'

import { useSetupText } from '../lib/text'

defineProps<{ table: SetupTable }>()

const text = useSetupText()

const DOT: Record<string, string> = {
  on: 'bg-success',
  off: 'bg-muted-foreground',
  warn: 'bg-warning',
  bad: 'bg-destructive',
}
const TONE: Record<string, string> = {
  on: 'text-foreground',
  off: 'text-muted-foreground',
  warn: 'text-warning',
  bad: 'text-destructive',
}

/** Secondary columns step back by weight rather than by colour, so no value is hard to read. */
const SECONDARY = 'font-normal text-foreground'
const PRIMARY = 'font-medium text-foreground'
</script>

<template>
  <div class="overflow-x-auto border-t border-border">
    <table class="w-full border-collapse text-xs">
      <thead>
        <tr class="bg-muted/40">
          <th
            v-for="(column, i) in table.columns"
            :key="i"
            scope="col"
            class="px-2.5 py-1.5 text-start text-[9.5px] font-semibold tracking-wide whitespace-nowrap text-muted-foreground uppercase"
          >
            {{ text(column) }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, r) in table.rows" :key="r" class="border-t border-border/60">
          <td
            v-for="(cell, c) in row"
            :key="c"
            class="h-[34px] px-2.5 whitespace-nowrap"
            :class="[c === 0 ? PRIMARY : SECONDARY, cell.state ? TONE[cell.state] : '']"
          >
            <span v-if="cell.state" class="inline-flex items-center gap-1.5">
              <span class="size-1.5 shrink-0 rounded-full" :class="DOT[cell.state]" aria-hidden="true" />
              {{ text(cell.text) }}
            </span>
            <template v-else>{{ text(cell.text) }}</template>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
