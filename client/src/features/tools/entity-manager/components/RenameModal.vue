<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { X } from '@lucide/vue'

const { t } = useI18n()

const props = defineProps<{
  currentName: string
  loading: boolean
}>()

const emit = defineEmits<{
  confirm: [newName: string, writeFiles: boolean]
  cancel: []
}>()

const newName = ref(props.currentName)
const writeFiles = ref(false)

function handleConfirm(): void {
  const trimmed = newName.value.trim()
  if (trimmed && trimmed !== props.currentName) {
    emit('confirm', trimmed, writeFiles.value)
  }
}

function handleCancel(): void {
  emit('cancel')
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="handleCancel">
    <div class="bg-card border border-border rounded-lg shadow-lg w-full max-w-md mx-4 overflow-hidden">
      <div class="flex items-center justify-between px-5 py-4 border-b border-border">
        <h3 class="text-base font-semibold">{{ t('tools.entityManager.renameModal.title') }}</h3>
        <button class="text-muted-foreground hover:text-foreground transition-colors" @click="handleCancel">
          <X class="h-5 w-5" />
        </button>
      </div>
      <div class="px-5 py-4 space-y-4">
        <div>
          <label class="text-sm text-muted-foreground block mb-1">{{ t('tools.entityManager.renameModal.currentName') }}</label>
          <p class="text-sm font-medium">{{ currentName }}</p>
        </div>
        <div>
          <label class="text-sm text-muted-foreground block mb-1">{{ t('tools.entityManager.renameModal.newName') }}</label>
          <input
            v-model="newName"
            type="text"
            class="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            @keydown.enter="handleConfirm"
          />
        </div>
        <label class="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
          <input v-model="writeFiles" type="checkbox" class="rounded accent-primary" />
          {{ t('tools.entityManager.writeChangesToFiles') }}
        </label>
      </div>
      <div class="flex justify-end gap-2 px-5 py-3 border-t border-border bg-muted/20">
        <button class="h-9 px-4 rounded-lg text-sm font-medium hover:bg-muted transition-colors" @click="handleCancel">
          {{ t('common.cancel') }}
        </button>
        <button
          class="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none transition-colors"
          :disabled="loading || !newName.trim() || newName.trim() === currentName"
          @click="handleConfirm"
        >
          {{ t('tools.entityManager.actions.rename') }}
        </button>
      </div>
    </div>
  </div>
</template>
