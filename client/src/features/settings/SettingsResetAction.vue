<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { RotateCcw } from '@lucide/vue'
import { useI18n } from 'vue-i18n'

const emit = defineEmits<{ reset: [] }>()

const { t } = useI18n()

function handleReset() {
  emit('reset')
}
</script>

<template>
  <div class="flex justify-end border-t border-border pt-4" data-testid="settings-reset-action">
    <Button variant="outline" size="sm" type="button" class="w-full md:w-auto" @click="handleReset">
      <RotateCcw :size="14" aria-hidden="true" />
      {{ t('settings.reader.resetToDefaults') }}
    </Button>
  </div>
</template>
