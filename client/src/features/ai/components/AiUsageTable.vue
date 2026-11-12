<script setup lang="ts">
export interface AiUsageColumn {
  key: string
  label: string
  /** Numbers line up on the end edge. */
  numeric?: boolean
}

defineProps<{
  columns: AiUsageColumn[]
  rows: Array<Record<string, string>>
  /** Names the table for screen readers; the visible heading sits above it. */
  label: string
  empty: string
}>()
</script>

<template>
  <p v-if="rows.length === 0" class="px-4 py-3 text-xs text-muted-foreground md:px-5">{{ empty }}</p>
  <div v-else class="overflow-x-auto px-4 py-3 md:px-5">
    <table class="w-full border-collapse text-xs" :aria-label="label">
      <thead>
        <tr>
          <th
            v-for="column in columns"
            :key="column.key"
            scope="col"
            class="whitespace-nowrap pb-1.5 pe-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground last:pe-0"
            :class="column.numeric ? 'text-end' : 'text-start'"
          >
            {{ column.label }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, index) in rows" :key="index" class="border-t border-border">
          <td
            v-for="column in columns"
            :key="column.key"
            class="py-1.5 pe-4 last:pe-0"
            :class="column.numeric ? 'whitespace-nowrap text-end tabular-nums text-foreground' : 'text-foreground'"
          >
            {{ row[column.key] }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
