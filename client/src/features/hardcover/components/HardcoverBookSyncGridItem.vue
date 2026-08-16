<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RefreshCw } from '@lucide/vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { useHardcoverBookSyncState } from '../composables/useHardcoverBookSyncState'

const { t } = useI18n()

const props = defineProps<{ bookId: number }>()
const bookIdRef = computed(() => props.bookId)
const { visible, syncEnabled, canSyncNow, statusText, statusClass, disabled, syncNow, setSyncEnabled } = useHardcoverBookSyncState(bookIdRef)
</script>

<template>
  <div v-if="visible" class="min-w-0">
    <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">{{ t('hardcover.bookSync.label') }}</dt>
    <dd class="mt-0.5 flex flex-wrap items-center gap-2">
      <ToggleSwitch
        :model-value="syncEnabled"
        :disabled="disabled"
        :aria-label="t('hardcover.bookSync.toggleAriaLabel')"
        @update:model-value="setSyncEnabled"
      />
      <span class="min-w-0 truncate text-sm" :class="statusClass">{{ statusText }}</span>
      <Button variant="outline" size="sm" v-if="canSyncNow" type="button" :disabled="disabled" @click="syncNow">
        <RefreshCw class="size-3.5" />
        {{ t('hardcover.bookSync.syncNow') }}
      </Button>
    </dd>
  </div>
</template>
