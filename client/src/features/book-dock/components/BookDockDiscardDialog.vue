<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { api } from '@/lib/api'

const props = defineProps<{
  selectionPayload: {
    fileIds?: number[]
    selectAll?: boolean
    excludedIds?: number[]
    status?: string
    needsReview?: boolean
    readyToFile?: boolean
    search?: string
  }
  selectionCount: number
}>()

const emit = defineEmits<{
  close: []
  discarded: []
}>()

const { t } = useI18n()
const discarding = ref(false)
const error = ref(false)

function handleClose() {
  if (!discarding.value) emit('close')
}

async function handleConfirm() {
  if (discarding.value) return
  discarding.value = true
  error.value = false

  try {
    const response = await api('/api/v1/book-dock/files/discard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(props.selectionPayload),
    })

    if (!response.ok) {
      error.value = true
      return
    }

    emit('discarded')
  } catch {
    error.value = true
  } finally {
    discarding.value = false
  }
}
</script>

<template>
  <ConfirmDialog
    open
    destructive
    :title="t('bookDock.discardDialog.title', { count: selectionCount })"
    :description="t('bookDock.discardDialog.description', { count: selectionCount })"
    :confirm-label="t('bookDock.discardDialog.confirm', { count: selectionCount })"
    :busy="discarding"
    @confirm="handleConfirm"
    @cancel="handleClose"
  >
    <p v-if="error" class="mt-3 text-sm text-destructive" role="alert">
      {{ t('bookDock.discardDialog.failed') }}
    </p>
  </ConfirmDialog>
</template>
