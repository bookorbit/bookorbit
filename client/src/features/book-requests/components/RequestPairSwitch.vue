<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { BookOpen, Headphones } from '@lucide/vue'
import type { BookRequestItem, BookRequestProgressEvent } from '@bookorbit/types'
import { orderedHalves } from '../requestPair'
import { currentRequestProgress, requestPresentationStatus } from '../requestPipeline'
import RequestStatusBadge from './RequestStatusBadge.vue'

/**
 * The two halves of a pair, side by side at the top of the drawer, each a link to its own request.
 *
 * Links rather than tabs: each half is its own page with its own URL, so a half can be linked to
 * and hard-loaded, and the browser's back button steps between them the way it steps through the
 * queue. The current half is marked for assistive technology as the current page.
 */
const props = defineProps<{
  request: BookRequestItem
  companion: BookRequestItem
  progressByRequest: Record<number, BookRequestProgressEvent | undefined>
}>()

const { t } = useI18n()
const route = useRoute()

const halves = computed(() => orderedHalves({ ...props.request, companion: props.companion }))

function iconFor(half: BookRequestItem) {
  return half.mediaKind === 'audiobook' ? Headphones : BookOpen
}

function statusFor(half: BookRequestItem): BookRequestItem['status'] {
  return requestPresentationStatus(half, currentRequestProgress(half, props.progressByRequest[half.id]))
}

function isCurrent(half: BookRequestItem): boolean {
  return half.id === props.request.id
}
</script>

<template>
  <nav class="mb-4 grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted p-1" :aria-label="t('bookRequests.detail.pairSwitchLabel')">
    <RouterLink
      v-for="half in halves"
      :key="half.id"
      :to="{ name: 'book-request-detail', params: { id: half.id }, query: route.query }"
      :aria-current="isCurrent(half) ? 'page' : undefined"
      class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2.5 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
      :class="
        isCurrent(half) ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground focus-visible:text-foreground'
      "
    >
      <component :is="iconFor(half)" :size="14" class="shrink-0" aria-hidden="true" />
      <span class="truncate">{{ t(`bookRequests.mediaKind.${half.mediaKind}`) }}</span>
      <RequestStatusBadge :status="statusFor(half)" class="ms-auto" />
    </RouterLink>
  </nav>
</template>
