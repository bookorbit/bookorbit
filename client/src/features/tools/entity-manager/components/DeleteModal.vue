<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, X } from '@lucide/vue'

const { t } = useI18n()

const props = defineProps<{
  entityName: string
  isInline: boolean
  defaultMode?: 'soft' | 'hard'
  loading: boolean
}>()

const emit = defineEmits<{
  confirm: [mode: 'soft' | 'hard' | 'inline', writeFiles: boolean]
  cancel: []
}>()

const deleteMode = ref<'soft' | 'hard'>(props.isInline ? 'hard' : (props.defaultMode ?? 'soft'))
const writeFiles = ref(false)

function handleConfirm(): void {
  const mode = props.isInline ? 'inline' : deleteMode.value
  emit('confirm', mode, writeFiles.value)
}

function handleCancel(): void {
  emit('cancel')
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="handleCancel">
    <div class="bg-card border border-border rounded-lg shadow-lg w-full max-w-md mx-4 overflow-hidden">
      <div class="flex items-center justify-between px-5 py-4 border-b border-border">
        <h3 class="text-base font-semibold text-destructive flex items-center gap-2">
          <AlertTriangle class="h-5 w-5" />
          {{ t('tools.entityManager.deleteModal.title') }}
        </h3>
        <button class="text-muted-foreground hover:text-foreground transition-colors" @click="handleCancel">
          <X class="h-5 w-5" />
        </button>
      </div>
      <div class="px-5 py-4 space-y-4">
        <p class="text-sm">
          <i18n-t keypath="tools.entityManager.deleteModal.confirm">
            <template #name>
              <span class="font-semibold">{{ entityName }}</span>
            </template>
          </i18n-t>
        </p>

        <div v-if="!isInline" class="space-y-2">
          <p class="text-xs text-muted-foreground font-medium uppercase tracking-wider">{{ t('tools.entityManager.deleteMode.label') }}</p>
          <label class="flex items-start gap-2 cursor-pointer">
            <input v-model="deleteMode" type="radio" value="soft" class="mt-1 accent-primary" />
            <div>
              <p class="text-sm font-medium">{{ t('tools.entityManager.deleteMode.softTitle') }}</p>
              <p class="text-xs text-muted-foreground">{{ t('tools.entityManager.deleteMode.softDescription') }}</p>
            </div>
          </label>
          <label class="flex items-start gap-2 cursor-pointer">
            <input v-model="deleteMode" type="radio" value="hard" class="mt-1 accent-primary" />
            <div>
              <p class="text-sm font-medium">{{ t('tools.entityManager.deleteMode.hardTitle') }}</p>
              <p class="text-xs text-muted-foreground">{{ t('tools.entityManager.deleteMode.hardDescription') }}</p>
            </div>
          </label>
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
          class="h-9 px-4 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 disabled:opacity-50 disabled:pointer-events-none transition-colors"
          :disabled="loading"
          @click="handleConfirm"
        >
          {{ t('common.delete') }}
        </button>
      </div>
    </div>
  </div>
</template>
