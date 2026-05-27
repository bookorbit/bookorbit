<script setup lang="ts">
import { computed, inject } from 'vue'
import { KOREADER_BOOK_STATS_KEY } from '@/features/koreader/composables/useKoreaderBookStats'
import KoreaderStatsStrip from './KoreaderStatsStrip.vue'
import KoreaderActivityChart from './KoreaderActivityChart.vue'
import KoreaderSessionTable from './KoreaderSessionTable.vue'

const { tabData, loading, page, pageSize, setPage } = inject(KOREADER_BOOK_STATS_KEY)!

const stats = computed(() => tabData.value?.stats ?? null)
const sessions = computed(() => tabData.value?.sessions ?? [])
const total = computed(() => tabData.value?.total ?? 0)
const dailySummary = computed(() => tabData.value?.dailySummary ?? [])

function handlePageChange(p: number) {
  setPage(p)
}
</script>

<template>
  <div class="space-y-4">
    <KoreaderStatsStrip :stats="stats" :total="total" :loading="loading" />
    <KoreaderActivityChart v-if="dailySummary.length > 0 || loading" :daily-summary="dailySummary" :loading="loading" />
    <KoreaderSessionTable :sessions="sessions" :total="total" :page="page" :page-size="pageSize" :loading="loading" @page-change="handlePageChange" />
  </div>
</template>
