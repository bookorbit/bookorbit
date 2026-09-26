<script setup lang="ts">
import { Download, Loader2 } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { PluginUpdateStatus } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'

defineProps<{
  updateable: boolean
  status?: PluginUpdateStatus
  busy?: boolean
}>()

const emit = defineEmits<{ review: []; automatic: [enabled: boolean] }>()
const { t } = useI18n()

function handleReview() {
  emit('review')
}

function handleAutomatic(enabled: boolean) {
  emit('automatic', enabled)
}
</script>

<template>
  <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
    <span v-if="status" role="status" class="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {{ t(`settings.system.requests.indexers.plugins.updateStates.${status.state}`, { version: status.latestVersion ?? '' }) }}
    </span>

    <Button v-if="status?.state === 'available'" size="sm" variant="outline" :disabled="busy" @click="handleReview">
      <Loader2 v-if="busy" class="animate-spin" aria-hidden="true" />
      <Download v-else :size="13" aria-hidden="true" />
      {{ t('settings.system.requests.indexers.plugins.reviewUpdate') }}
    </Button>

    <label v-if="updateable" class="flex items-center gap-2 text-xs text-foreground">
      <ToggleSwitch
        :model-value="status?.autoUpdate ?? false"
        :disabled="busy"
        :aria-label="t('settings.system.requests.indexers.plugins.autoUpdate')"
        @update:model-value="handleAutomatic"
      />
      {{ t('settings.system.requests.indexers.plugins.autoUpdate') }}
    </label>
  </div>
</template>
