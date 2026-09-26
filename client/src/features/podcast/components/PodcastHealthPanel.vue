<script setup lang="ts">
import { toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertCircle, CheckCircle2, ExternalLink, FileCode, RefreshCw } from '@lucide/vue'
import type { PodcastFeedHealth } from '@bookorbit/types'
import { formatDateTime } from '@/i18n/formatters'
import EmptyState from '@/components/EmptyState.vue'
import { Button } from '@/components/ui/button'
import { usePodcastFeedHealth } from '../composables/usePodcastFeedHealth'

const props = defineProps<{ items: PodcastFeedHealth[]; refreshing: boolean }>()
const emit = defineEmits<{ 'open-show': [podcastId: number] }>()

const { t } = useI18n()
// The lane owns the paged list and the refresh events that keep it current; the composable owns
// every write against it, including which rows a bulk retry covers.
const { refreshingPodcastId, reparsingPodcastId, refreshingUnhealthy, hasUnhealthyFeeds, refresh, reparse, refreshUnhealthy } = usePodcastFeedHealth(
  toRef(props, 'items'),
)

function openShow(podcastId: number) {
  emit('open-show', podcastId)
}
</script>

<template>
  <section class="pt-4" :aria-busy="refreshing">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 class="font-serif text-xl font-semibold tracking-tight">{{ t('podcast.library.manageFeeds') }}</h2>
      <Button v-if="hasUnhealthyFeeds" variant="outline" size="sm" class="gap-1.5" :disabled="refreshingUnhealthy" @click="refreshUnhealthy">
        <RefreshCw :size="14" :class="refreshingUnhealthy ? 'animate-spin motion-reduce:animate-none' : ''" />
        {{ t('podcast.library.retryUnhealthyLoaded') }}
      </Button>
    </div>
    <div v-if="items.length > 0" class="overflow-hidden rounded-xl border border-border">
      <div
        v-for="item in items"
        :key="item.podcastId"
        class="flex flex-col gap-1 border-b border-border p-4 last:border-0 md:flex-row md:items-center"
      >
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium">{{ item.title }}</p>
          <p class="text-xs text-muted-foreground">
            {{ t('podcast.library.lastSuccess') }}:
            {{ item.lastRefreshSuccessAt ? formatDateTime(new Date(item.lastRefreshSuccessAt)) : t('podcast.acquisition.never') }}
          </p>
        </div>
        <div class="flex min-w-0 flex-wrap items-center gap-2 md:justify-end">
          <span class="inline-flex min-w-0 items-center gap-1 text-xs" :class="item.consecutiveFailures ? 'text-destructive' : 'text-success'">
            <AlertCircle v-if="item.consecutiveFailures" class="h-3 w-3 shrink-0" />
            <CheckCircle2 v-else class="h-3 w-3 shrink-0" />
            <span class="break-words">
              {{
                item.consecutiveFailures
                  ? t('podcast.library.failureCount', {
                      count: item.consecutiveFailures,
                      error: item.lastError || t('podcast.library.unknownError'),
                    })
                  : t('podcast.library.healthy')
              }}
            </span>
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            class="text-muted-foreground hover:text-foreground"
            :aria-label="t('podcast.library.openShow', { title: item.title })"
            @click="openShow(item.podcastId)"
          >
            <ExternalLink :size="14" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            class="text-muted-foreground hover:text-foreground"
            :disabled="refreshingPodcastId === item.podcastId"
            :aria-label="t('podcast.library.retryFeed', { title: item.title })"
            @click="refresh(item.podcastId)"
          >
            <RefreshCw :size="14" :class="refreshingPodcastId === item.podcastId ? 'animate-spin motion-reduce:animate-none' : ''" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            class="text-muted-foreground hover:text-foreground"
            :disabled="reparsingPodcastId === item.podcastId"
            :aria-label="t('podcast.library.reparseFeed', { title: item.title })"
            @click="reparse(item.podcastId)"
          >
            <FileCode :size="14" />
          </Button>
        </div>
      </div>
    </div>
    <EmptyState v-else icon="Radio" :title="t('podcast.library.noFeeds')" :hint="t('podcast.library.noFeedsDescription')" />
  </section>
</template>
