<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { RefreshCw } from '@lucide/vue'

defineProps<{
  busy?: boolean
}>()

const emit = defineEmits<{ searchFresh: [] }>()

const { t } = useI18n()

function handleClick() {
  emit('searchFresh')
}
</script>

<template>
  <button
    type="button"
    class="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 text-[11.5px] font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
    :disabled="busy"
    :title="t('metadataCache.notice.searchFreshHint')"
    data-testid="metadata-cache-search-fresh"
    @click="handleClick"
  >
    <RefreshCw class="size-3" aria-hidden="true" />{{ t('metadataCache.notice.searchFresh') }}
  </button>
</template>
