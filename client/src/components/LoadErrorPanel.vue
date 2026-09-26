<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'

/** The message-plus-retry block every list, sheet and detail pane shows when a read fails. */
defineProps<{ message: string }>()

const emit = defineEmits<{ retry: [] }>()
const { t } = useI18n()

function handleRetry() {
  emit('retry')
}
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-4 p-6 text-center" role="alert">
    <p class="text-sm text-destructive">{{ message }}</p>
    <Button type="button" variant="outline" @click="handleRetry">{{ t('common.retry') }}</Button>
  </div>
</template>
