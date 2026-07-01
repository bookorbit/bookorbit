<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, GitMerge, X } from '@lucide/vue'
import type { BrowseEntityItem } from '@bookorbit/types'

const { t } = useI18n()

const props = defineProps<{
  items: BrowseEntityItem[]
  loading: boolean
}>()

const emit = defineEmits<{
  confirm: [targetId: number | string, sourceIds: (number | string)[], writeFiles: boolean]
  cancel: []
}>()

const defaultTarget = computed(() => [...props.items].sort((a, b) => b.bookCount - a.bookCount)[0])
const selectedTargetId = ref<number | string>(defaultTarget.value?.id ?? '')
const writeFiles = ref(false)

const sourceIds = computed(() => props.items.filter((i) => i.id !== selectedTargetId.value).map((i) => i.id))

function handleSelectTarget(id: number | string): void {
  selectedTargetId.value = id
}

function handleConfirm(): void {
  emit('confirm', selectedTargetId.value, sourceIds.value, writeFiles.value)
}

function handleCancel(): void {
  emit('cancel')
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="handleCancel">
    <div class="bg-card border border-border rounded-lg shadow-lg w-full max-w-lg mx-4 overflow-hidden flex flex-col h-150 max-h-[85vh]">
      <div class="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
        <h3 class="text-base font-semibold flex items-center gap-2">
          <GitMerge class="h-5 w-5 text-primary" />
          {{ t('tools.entityManager.mergeModal.title') }}
        </h3>
        <button class="text-muted-foreground hover:text-foreground transition-colors" @click="handleCancel">
          <X class="h-5 w-5" />
        </button>
      </div>

      <div class="px-5 py-4 flex-1 min-h-0 flex flex-col overflow-hidden">
        <p class="text-sm text-muted-foreground shrink-0 mb-4">{{ t('tools.entityManager.mergeModal.description') }}</p>

        <div class="flex-1 min-h-0 overflow-y-auto pr-1">
          <p class="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1.5 sticky top-0 bg-card py-1 z-10">
            {{ t('tools.entityManager.selectTargetToKeep') }}
          </p>
          <div class="space-y-1.5">
            <div
              v-for="item in items"
              :key="String(item.id)"
              class="flex items-center gap-3 px-3 py-2 rounded-md border transition-colors cursor-pointer"
              :class="selectedTargetId === item.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/30'"
              @click="handleSelectTarget(item.id)"
            >
              <div class="flex-1 min-w-0">
                <span class="text-sm font-medium truncate block">{{ item.name }}</span>
                <span class="text-xs text-muted-foreground">{{ t('tools.entityManager.bookCount', { count: item.bookCount }, item.bookCount) }}</span>
              </div>
              <Check v-if="selectedTargetId === item.id" class="h-4 w-4 text-primary shrink-0" />
            </div>
          </div>
        </div>

        <label class="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer shrink-0 mt-4">
          <input v-model="writeFiles" type="checkbox" class="rounded accent-primary" />
          {{ t('tools.entityManager.writeChangesToFiles') }}
        </label>
      </div>

      <div class="flex justify-end gap-2 px-5 py-3 border-t border-border bg-muted/20 shrink-0">
        <button class="h-9 px-4 rounded-lg text-sm font-medium hover:bg-muted transition-colors" @click="handleCancel">
          {{ t('common.cancel') }}
        </button>
        <button
          class="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none transition-colors"
          :disabled="loading || sourceIds.length === 0"
          @click="handleConfirm"
        >
          {{ t('tools.entityManager.mergeIntoTarget', { count: sourceIds.length }) }}
        </button>
      </div>
    </div>
  </div>
</template>
