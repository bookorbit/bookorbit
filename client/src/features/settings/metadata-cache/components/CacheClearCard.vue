<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Loader2, Trash2 } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import type { CacheClearScope } from '../composables/useMetadataCacheMaintenance'

defineProps<{
  clearing: CacheClearScope | null
}>()

const emit = defineEmits<{ request: [CacheClearScope] }>()

const { t } = useI18n()

const ACTIONS: { scope: CacheClearScope; labelKey: string; hintKey: string }[] = [
  { scope: 'empty', labelKey: 'settings.metadata.searchCache.clear.empty.label', hintKey: 'settings.metadata.searchCache.clear.empty.hint' },
  { scope: 'book', labelKey: 'settings.metadata.searchCache.clear.book.label', hintKey: 'settings.metadata.searchCache.clear.book.hint' },
  { scope: 'author', labelKey: 'settings.metadata.searchCache.clear.author.label', hintKey: 'settings.metadata.searchCache.clear.author.hint' },
  { scope: 'all', labelKey: 'settings.metadata.searchCache.clear.all.label', hintKey: 'settings.metadata.searchCache.clear.all.hint' },
]

function handleRequest(scope: CacheClearScope) {
  emit('request', scope)
}
</script>

<template>
  <section class="settings-card" aria-labelledby="metadata-cache-clear-title">
    <div class="settings-card-header">
      <h3 id="metadata-cache-clear-title" class="settings-card-title">{{ t('settings.metadata.searchCache.clear.title') }}</h3>
    </div>
    <div v-for="action in ACTIONS" :key="action.scope" class="settings-row">
      <div class="min-w-0 settings-prose">
        <p class="settings-label">{{ t(action.labelKey) }}</p>
        <p class="settings-hint">{{ t(action.hintKey) }}</p>
      </div>
      <Button
        variant="destructive-outline"
        size="sm"
        type="button"
        class="self-start md:self-auto"
        :disabled="clearing !== null"
        :aria-label="t(action.labelKey)"
        :data-testid="`cache-clear-${action.scope}`"
        @click="handleRequest(action.scope)"
      >
        <Loader2 v-if="clearing === action.scope" class="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <Trash2 v-else class="size-3.5" aria-hidden="true" />
        {{ t('settings.metadata.searchCache.clear.action') }}
      </Button>
    </div>
  </section>
</template>
