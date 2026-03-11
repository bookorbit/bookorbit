<script setup lang="ts">
import type { GroupRule, Rule } from '@projectx/types'
import { ruleToParts } from '@/features/book/lib/filter-labels'

defineProps<{
  node: GroupRule
  depth?: number
}>()
</script>

<template>
  <span class="inline-flex flex-wrap items-center gap-1">
    <span
      class="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded shrink-0"
      :class="node.join === 'OR' ? 'bg-amber-500/15 text-amber-500' : 'bg-sky-500/15 text-sky-500'"
    >
      {{ node.join === 'AND' ? 'ALL' : 'ANY' }}
    </span>

    <template v-for="(rule, i) in node.rules" :key="i">
      <span v-if="i > 0" class="text-[10px] text-muted-foreground/40 font-medium select-none">
        {{ node.join === 'AND' ? '·' : '|' }}
      </span>

      <!-- Leaf rule: color-coded field / operator / value -->
      <span v-if="rule.type === 'rule'" class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border bg-muted/40 border-border/60">
        <span class="font-semibold text-foreground">{{ ruleToParts(rule as Rule).field }}</span>
        <span class="font-normal" :class="ruleToParts(rule as Rule).value === null ? 'text-primary font-semibold' : 'text-muted-foreground'">{{
          ruleToParts(rule as Rule).operator
        }}</span>
        <span v-if="ruleToParts(rule as Rule).value !== null" class="font-semibold text-primary">
          {{ ruleToParts(rule as Rule).value }}
        </span>
      </span>

      <!-- Nested group -->
      <span v-else class="inline-flex flex-wrap items-center gap-1 px-2 py-0.5 rounded-lg border border-border/50 bg-muted/30">
        <FilterSummary :node="rule as GroupRule" :depth="(depth ?? 0) + 1" />
      </span>
    </template>
  </span>
</template>
