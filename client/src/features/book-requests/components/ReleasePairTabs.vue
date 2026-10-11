<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { LocationQuery } from 'vue-router'
import { Check, Loader2 } from '@lucide/vue'
import type { BookRequestItem, BookRequestStatus } from '@bookorbit/types'
import RequestStatusBadge from './RequestStatusBadge.vue'
import { requestMediaIcon } from '../requestMedia'

export interface ReleasePairTab {
  request: BookRequestItem
  current: boolean
  /** Whether this viewer can pick a release for it now. Only those, and the open one, are links. */
  choosable: boolean
  /** How many releases its search found, or null before it has answered. */
  count: number | null
  searching: boolean
}

/**
 * The two halves of a pair inside the release picker. Each tab says whether it still needs a
 * release, so the half you are not looking at cannot be forgotten the way a passing toast was.
 */
const props = defineProps<{ tabs: ReleasePairTab[]; query: LocationQuery }>()

const { t } = useI18n()

/** Past the choice and on their way, which from here reads as done, not as three tracker states. */
const SENT_STATUSES: readonly BookRequestStatus[] = ['grabbed', 'downloading', 'importing']

/** Only the other half, and only while it still needs a release, is somewhere to go. */
function isLink(tab: ReleasePairTab): boolean {
  return !tab.current && tab.choosable
}

function linkProps(tab: ReleasePairTab) {
  if (isLink(tab)) return { to: { name: 'book-request-releases', params: { id: tab.request.id }, query: props.query } }
  return tab.current ? { 'aria-current': 'page' } : {}
}

function tabClass(tab: ReleasePairTab): string {
  if (tab.current) return 'bg-background text-foreground shadow-xs'
  if (tab.choosable) return 'text-muted-foreground hover:text-foreground focus-visible:text-foreground'
  return 'text-muted-foreground'
}

function isSent(tab: ReleasePairTab): boolean {
  return SENT_STATUSES.includes(tab.request.status)
}
</script>

<template>
  <nav class="mt-4 grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted p-1" :aria-label="t('bookRequests.releases.pair.tabsLabel')">
    <component
      :is="isLink(tab) ? 'RouterLink' : 'span'"
      v-for="tab in tabs"
      :key="tab.request.id"
      v-bind="linkProps(tab)"
      class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2.5 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
      :class="tabClass(tab)"
    >
      <component :is="requestMediaIcon(tab.request.mediaKind)" :size="14" class="shrink-0" aria-hidden="true" />
      <span class="truncate">{{ t(`bookRequests.mediaKind.${tab.request.mediaKind}`) }}</span>
      <span v-if="tab.searching" class="flex items-center gap-1 text-xs font-normal text-muted-foreground">
        <Loader2 class="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        {{ t('bookRequests.releases.pair.searching') }}
      </span>
      <span v-else-if="tab.choosable && tab.count !== null" class="text-xs font-normal text-muted-foreground tabular-nums">
        {{ t('bookRequests.releases.pair.releaseCount', { count: tab.count }) }}
      </span>

      <span
        v-if="tab.choosable"
        class="ms-auto inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full border border-info/40 bg-info/10 px-2 text-xs font-medium whitespace-nowrap text-info"
      >
        <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
        {{ t('bookRequests.releases.pair.toChoose') }}
      </span>
      <span
        v-else-if="isSent(tab)"
        class="ms-auto inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2 text-xs font-medium whitespace-nowrap text-success"
      >
        <Check :size="12" :stroke-width="2.5" aria-hidden="true" />
        {{ t('bookRequests.releases.pair.sent') }}
      </span>
      <RequestStatusBadge v-else :status="tab.request.status" class="ms-auto" />
    </component>
  </nav>
</template>
