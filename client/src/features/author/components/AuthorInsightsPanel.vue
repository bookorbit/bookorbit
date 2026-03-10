<script setup lang="ts">
import type { AuthorInsights } from '@projectx/types'

defineProps<{
  insights: AuthorInsights | null
  loading: boolean
  error: string | null
}>()
</script>

<template>
  <section class="rounded-xl border border-border/70 bg-card/60 p-3">
    <div class="mb-2 flex items-center justify-between">
      <h2 class="text-sm font-semibold text-foreground">Author Insights (30d)</h2>
      <span v-if="insights" class="text-[11px] text-muted-foreground">Updated {{ new Date(insights.generatedAt).toLocaleTimeString() }}</span>
    </div>

    <div v-if="error" class="rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-destructive">
      {{ error }}
    </div>

    <div v-else-if="loading" class="py-3 text-xs text-muted-foreground">Loading insights...</div>

    <div v-else-if="insights" class="grid gap-3 md:grid-cols-3">
      <div class="rounded-lg border border-border/70 bg-background/40 p-2.5">
        <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">New Authors</p>
        <div class="space-y-1.5">
          <div v-for="row in insights.newAuthors.slice(0, 5)" :key="`new-${row.id}`" class="flex items-center justify-between gap-2 text-xs">
            <span class="truncate text-foreground">{{ row.name }}</span>
            <span class="text-muted-foreground">{{ row.metric }} new</span>
          </div>
          <p v-if="insights.newAuthors.length === 0" class="text-xs text-muted-foreground">No new authors in this window.</p>
        </div>
      </div>

      <div class="rounded-lg border border-border/70 bg-background/40 p-2.5">
        <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Most Read</p>
        <div class="space-y-1.5">
          <div v-for="row in insights.mostRead.slice(0, 5)" :key="`read-${row.id}`" class="flex items-center justify-between gap-2 text-xs">
            <span class="truncate text-foreground">{{ row.name }}</span>
            <span class="text-muted-foreground">{{ row.metric }} readers</span>
          </div>
          <p v-if="insights.mostRead.length === 0" class="text-xs text-muted-foreground">No read activity recorded.</p>
        </div>
      </div>

      <div class="rounded-lg border border-border/70 bg-background/40 p-2.5">
        <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Unread Backlog</p>
        <div class="space-y-1.5">
          <div v-for="row in insights.unreadBacklog.slice(0, 5)" :key="`unread-${row.id}`" class="flex items-center justify-between gap-2 text-xs">
            <span class="truncate text-foreground">{{ row.name }}</span>
            <span class="text-muted-foreground">{{ row.metric }} unread</span>
          </div>
          <p v-if="insights.unreadBacklog.length === 0" class="text-xs text-muted-foreground">No unread backlog found.</p>
        </div>
      </div>
    </div>
  </section>
</template>
