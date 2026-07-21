<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { ArrowLeft, BookOpen, ShieldCheck } from '@lucide/vue'
import type { BroadReadingGenre } from '@bookorbit/types'

import { formatDate, formatDateTime, formatNumber } from '@/i18n/formatters'
import { useSharedReadingInsights } from './composables/useSharedReadingInsights'

const props = defineProps<{ userId: number }>()
const { t } = useI18n()
const router = useRouter()
const insights = useSharedReadingInsights(() => props.userId)
const rankedGroups = computed(() => {
  const detail = insights.detail.value
  if (!detail) return []
  return [
    { key: 'authors', items: detail.topAuthors },
    { key: 'genres', items: detail.topGenres },
    { key: 'series', items: detail.topSeries },
    { key: 'narrators', items: detail.topNarrators },
  ]
})
const metricCards = computed(() => {
  const summary = insights.summary.value
  if (!summary) return []
  return [
    { key: 'sessions', value: formatNumber(summary.sessionsCount) },
    { key: 'readingTime', value: durationLabel(summary.readingSeconds) },
    { key: 'activeDays', value: formatNumber(summary.activeDays) },
    { key: 'started', value: formatNumber(summary.booksStarted) },
    { key: 'completed', value: formatNumber(summary.booksCompleted) },
  ]
})
const hasReadingData = computed(() => {
  const summary = insights.summary.value
  if (!summary) return false
  return (
    summary.sessionsCount > 0 ||
    summary.booksStarted > 0 ||
    summary.booksCompleted > 0 ||
    summary.formatDistribution.length > 0 ||
    summary.genreDistribution.length > 0 ||
    summary.sourceCoverage.length > 0
  )
})
const trendPoints = computed(() => insights.summary.value?.trend.slice(-12) ?? [])
const trendMaxSeconds = computed(() => Math.max(...trendPoints.value.map((point) => point.readingSeconds), 1))

onMounted(insights.initialize)
watch(() => props.userId, insights.initialize)

function handleBack() {
  router.push({ name: 'settings-admin', query: { tab: 'account-activity' } })
}

function handlePeriodChange() {
  void insights.loadInsights()
}

function durationLabel(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return t('adminFeature.sharedInsights.durationMinutes', { count: minutes }, minutes)
  return t('adminFeature.sharedInsights.durationHours', { count: formatNumber(Math.round((minutes / 60) * 10) / 10) })
}

function trendDayLabel(day: string): string {
  return formatDate(new Date(`${day}T12:00:00`), { month: 'short', day: 'numeric' })
}

function genreLabel(genre: BroadReadingGenre): string {
  return t(`adminFeature.sharedInsights.broadGenres.${genre}`)
}

function sourceLabel(source: string): string {
  if (['web', 'koreader', 'manual', 'kobo', 'unknown'].includes(source)) {
    return t(`adminFeature.sharedInsights.sourceNames.${source}`)
  }
  return source
}

function trendWidth(readingSeconds: number): string {
  return `${Math.max(4, Math.round((readingSeconds / trendMaxSeconds.value) * 100))}%`
}
</script>

<template>
  <section class="space-y-4">
    <div class="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start lg:grid-cols-[auto_minmax(0,1fr)_12rem]">
      <button type="button" class="settings-btn-outline h-9 justify-self-start sm:mt-0.5" @click="handleBack">
        <ArrowLeft :size="15" aria-hidden="true" />
        {{ t('common.back') }}
      </button>

      <div class="min-w-0">
        <h1 class="truncate text-xl font-semibold text-foreground">{{ insights.account.value?.name ?? t('adminFeature.sharedInsights.title') }}</h1>
        <p class="mt-1 text-sm text-muted-foreground">{{ t('adminFeature.sharedInsights.subtitle') }}</p>
        <div
          class="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs text-muted-foreground"
        >
          <ShieldCheck :size="14" class="shrink-0 text-primary" aria-hidden="true" />
          <span class="truncate">{{ t('adminFeature.sharedInsights.auditNotice') }}</span>
        </div>
      </div>

      <label class="block w-full sm:col-start-2 lg:col-start-3 lg:row-start-1">
        <span class="mb-1 block text-xs font-medium text-muted-foreground">{{ t('adminFeature.sharedInsights.period') }}</span>
        <select
          v-model="insights.days.value"
          class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          @change="handlePeriodChange"
        >
          <option :value="30">{{ t('adminFeature.sharedInsights.periodDays', { count: 30 }) }}</option>
          <option :value="90">{{ t('adminFeature.sharedInsights.periodDays', { count: 90 }) }}</option>
          <option :value="365">{{ t('adminFeature.sharedInsights.periodDays', { count: 365 }) }}</option>
        </select>
      </label>
    </div>

    <p
      v-if="insights.loading.value"
      role="status"
      class="rounded-lg border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground"
    >
      {{ t('common.loading') }}
    </p>
    <div v-else-if="insights.errorCode.value" role="alert" class="rounded-lg border border-border bg-card p-5 text-center">
      <p class="font-medium text-foreground">{{ t(`adminFeature.sharedInsights.errors.${insights.errorCode.value}`) }}</p>
      <p class="mt-1 text-sm text-muted-foreground">{{ t('adminFeature.sharedInsights.errors.cleared') }}</p>
    </div>

    <template v-else-if="insights.summary.value">
      <dl class="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        <div v-for="metric in metricCards" :key="metric.key" class="rounded-lg border border-border bg-card px-3 py-2.5">
          <dt class="truncate text-xs text-muted-foreground">{{ t(`adminFeature.sharedInsights.metrics.${metric.key}`) }}</dt>
          <dd class="mt-1 text-lg font-semibold leading-none text-foreground">{{ metric.value }}</dd>
        </div>
      </dl>

      <div v-if="!hasReadingData" class="rounded-lg border border-dashed border-border bg-card px-4 py-8 text-center">
        <BookOpen :size="24" class="mx-auto text-muted-foreground" aria-hidden="true" />
        <p class="mt-3 text-sm font-medium text-foreground">{{ t('adminFeature.sharedInsights.emptyTitle') }}</p>
        <p class="mt-1 text-sm text-muted-foreground">{{ t('adminFeature.sharedInsights.noData') }}</p>
      </div>

      <template v-else>
        <div class="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(16rem,0.7fr)]">
          <section class="rounded-lg border border-border bg-card p-3">
            <h2 class="text-sm font-semibold text-foreground">{{ t('adminFeature.sharedInsights.trend') }}</h2>
            <p v-if="trendPoints.length === 0" class="mt-3 text-sm text-muted-foreground">{{ t('adminFeature.sharedInsights.noData') }}</p>
            <ol v-else class="mt-3 space-y-2">
              <li v-for="point in trendPoints" :key="point.day" class="grid grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-2 text-xs">
                <time :datetime="point.day" class="text-muted-foreground">{{ trendDayLabel(point.day) }}</time>
                <span class="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <span class="block h-full rounded-full bg-primary/75" :style="{ width: trendWidth(point.readingSeconds) }" />
                </span>
                <span class="whitespace-nowrap text-muted-foreground">{{ durationLabel(point.readingSeconds) }}</span>
              </li>
            </ol>
          </section>

          <section class="rounded-lg border border-border bg-card p-3">
            <h2 class="text-sm font-semibold text-foreground">{{ t('adminFeature.sharedInsights.sources') }}</h2>
            <p v-if="insights.summary.value.sourceCoverage.length === 0" class="mt-3 text-sm text-muted-foreground">
              {{ t('adminFeature.sharedInsights.noData') }}
            </p>
            <ul v-else class="mt-3 divide-y divide-border">
              <li
                v-for="item in insights.summary.value.sourceCoverage"
                :key="item.source"
                class="flex justify-between gap-3 py-2 text-sm first:pt-0 last:pb-0"
              >
                <span class="text-foreground">{{ sourceLabel(item.source) }}</span>
                <span class="whitespace-nowrap text-xs text-muted-foreground">{{ durationLabel(item.readingSeconds) }}</span>
              </li>
            </ul>
          </section>
        </div>

        <div class="grid gap-3 lg:grid-cols-2">
          <section class="rounded-lg border border-border bg-card p-3">
            <h2 class="text-sm font-semibold text-foreground">{{ t('adminFeature.sharedInsights.formats') }}</h2>
            <p v-if="insights.summary.value.formatDistribution.length === 0" class="mt-3 text-sm text-muted-foreground">
              {{ t('adminFeature.sharedInsights.noData') }}
            </p>
            <ul v-else class="mt-3 grid gap-x-5 gap-y-2 sm:grid-cols-2">
              <li v-for="item in insights.summary.value.formatDistribution" :key="item.name" class="flex justify-between gap-3 text-sm">
                <span class="text-foreground">{{ item.name }}</span>
                <span class="whitespace-nowrap text-xs text-muted-foreground">{{ durationLabel(item.readingSeconds) }}</span>
              </li>
            </ul>
          </section>

          <section class="rounded-lg border border-border bg-card p-3">
            <h2 class="text-sm font-semibold text-foreground">{{ t('adminFeature.sharedInsights.genres') }}</h2>
            <p v-if="insights.summary.value.genreDistribution.length === 0" class="mt-3 text-sm text-muted-foreground">
              {{ t('adminFeature.sharedInsights.noData') }}
            </p>
            <ul v-else class="mt-3 grid gap-x-5 gap-y-2 sm:grid-cols-2">
              <li v-for="item in insights.summary.value.genreDistribution" :key="item.name" class="flex justify-between gap-3 text-sm">
                <span class="text-foreground">{{ genreLabel(item.name) }}</span>
                <span class="whitespace-nowrap text-xs text-muted-foreground">{{ durationLabel(item.readingSeconds) }}</span>
              </li>
            </ul>
          </section>
        </div>

        <template v-if="insights.detail.value">
          <div class="grid gap-3 lg:grid-cols-2">
            <section class="rounded-lg border border-border bg-card p-3">
              <h2 class="text-sm font-semibold text-foreground">{{ t('adminFeature.sharedInsights.topBooks') }}</h2>
              <p v-if="insights.detail.value.topBooks.length === 0" class="mt-3 text-sm text-muted-foreground">
                {{ t('adminFeature.sharedInsights.noData') }}
              </p>
              <ul v-else class="mt-3 divide-y divide-border">
                <li v-for="book in insights.detail.value.topBooks" :key="book.bookId" class="flex justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <span class="min-w-0 truncate text-sm text-foreground">{{ book.title ?? t('adminFeature.sharedInsights.unknownTitle') }}</span>
                  <span class="shrink-0 text-xs text-muted-foreground">{{ durationLabel(book.readingSeconds) }}</span>
                </li>
              </ul>
            </section>

            <section class="rounded-lg border border-border bg-card p-3">
              <h2 class="text-sm font-semibold text-foreground">{{ t('adminFeature.sharedInsights.recentBooks') }}</h2>
              <p v-if="insights.detail.value.recentBooks.length === 0" class="mt-3 text-sm text-muted-foreground">
                {{ t('adminFeature.sharedInsights.noData') }}
              </p>
              <ul v-else class="mt-3 divide-y divide-border">
                <li v-for="book in insights.detail.value.recentBooks" :key="book.bookId" class="py-2 first:pt-0 last:pb-0">
                  <p class="truncate text-sm text-foreground">{{ book.title ?? t('adminFeature.sharedInsights.unknownTitle') }}</p>
                  <time :datetime="book.lastReadAt" class="text-xs text-muted-foreground">{{ formatDateTime(new Date(book.lastReadAt)) }}</time>
                </li>
              </ul>
            </section>
          </div>

          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <section v-for="group in rankedGroups" :key="group.key" class="rounded-lg border border-border bg-card p-3">
              <h2 class="text-sm font-semibold text-foreground">{{ t(`adminFeature.sharedInsights.top.${group.key}`) }}</h2>
              <p v-if="group.items.length === 0" class="mt-3 text-sm text-muted-foreground">{{ t('adminFeature.sharedInsights.noData') }}</p>
              <ol v-else class="mt-3 space-y-2">
                <li v-for="item in group.items" :key="item.name" class="flex justify-between gap-3 text-sm">
                  <span class="min-w-0 truncate text-foreground">{{ item.name }}</span>
                  <span class="shrink-0 text-xs text-muted-foreground">{{ durationLabel(item.readingSeconds) }}</span>
                </li>
              </ol>
            </section>
          </div>
        </template>
      </template>
    </template>
  </section>
</template>
