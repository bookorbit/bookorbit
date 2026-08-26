<script setup lang="ts">
import { useI18n } from 'vue-i18n'

withDefaults(defineProps<{ rows?: number }>(), { rows: 6 })

const { t } = useI18n()
</script>

<template>
  <!--
    Skeleton rows rather than a line of text. They hold the shape the table is about to take, so
    the page does not jump when the data lands.
  -->
  <div class="rounded-lg border border-border bg-card" role="status" :aria-label="t('bookRequests.list.loading')">
    <div
      v-for="row in rows"
      :key="row"
      class="flex animate-pulse items-center gap-3 border-b border-border/60 p-3 last:border-b-0 motion-reduce:animate-none"
    >
      <div class="h-[46px] w-8 shrink-0 rounded bg-muted" />
      <div class="flex-1 space-y-2">
        <div class="h-3.5 w-2/5 rounded bg-muted" />
        <div class="h-3 w-1/4 rounded bg-muted" />
      </div>
      <div class="hidden h-5 w-20 shrink-0 rounded-full bg-muted lg:block" />
      <div class="hidden h-3 w-32 shrink-0 rounded bg-muted lg:block" />
      <div class="h-8 w-20 shrink-0 rounded-md bg-muted" />
    </div>
    <span class="sr-only">{{ t('bookRequests.list.loading') }}</span>
  </div>
</template>
