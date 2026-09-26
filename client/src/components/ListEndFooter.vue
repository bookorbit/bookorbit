<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { formatNumber } from '@/i18n/formatters'

/**
 * The strip under an infinitely scrolling list: "loading" while a page is in flight, then a count
 * once there is nothing left to fetch. Both messages are suppressed for an empty list, where the
 * empty state already says everything.
 */
defineProps<{ loadingMore: boolean; atEnd: boolean; total: number }>()

const { t } = useI18n()
</script>

<template>
  <div class="mt-4 flex h-8 items-center justify-center">
    <span v-if="loadingMore" class="text-xs text-muted-foreground" role="status">{{ t('common.loading') }}</span>
    <span v-else-if="atEnd" class="text-xs text-muted-foreground">
      {{ t('podcast.library.allLoaded', { total: formatNumber(total) }) }}
    </span>
  </div>
</template>
