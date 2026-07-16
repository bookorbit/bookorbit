<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Trash2, X } from '@lucide/vue'

const { t } = useI18n()

defineProps<{
  entityName: string
  loading: boolean
}>()

const emit = defineEmits<{
  confirm: [newNames: string[], writeFiles: boolean]
  cancel: []
}>()

const newNames = ref<string[]>(['', ''])
const writeFiles = ref(false)

function addName(): void {
  newNames.value.push('')
}

function removeName(index: number): void {
  if (newNames.value.length > 2) {
    newNames.value.splice(index, 1)
  }
}

function updateName(index: number, event: Event): void {
  newNames.value[index] = (event.target as HTMLInputElement).value
}

function handleConfirm(): void {
  const valid = newNames.value.map((n) => n.trim()).filter(Boolean)
  if (valid.length >= 2) {
    emit('confirm', valid, writeFiles.value)
  }
}

function handleCancel(): void {
  emit('cancel')
}

function isValid(): boolean {
  return newNames.value.map((n) => n.trim()).filter(Boolean).length >= 2
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="handleCancel">
    <div class="bg-card border border-border rounded-lg shadow-lg w-full max-w-md mx-4 overflow-hidden">
      <div class="flex items-center justify-between px-5 py-4 border-b border-border">
        <h3 class="text-base font-semibold">{{ t('tools.entityManager.splitModal.title') }}</h3>
        <button class="text-muted-foreground hover:text-foreground transition-colors" @click="handleCancel">
          <X class="h-5 w-5" />
        </button>
      </div>
      <div class="px-5 py-4 space-y-4">
        <div>
          <p class="text-sm text-muted-foreground mb-1">{{ t('tools.entityManager.splitModal.splitting') }}</p>
          <p class="text-sm font-semibold">{{ entityName }}</p>
        </div>
        <div class="space-y-2">
          <p class="text-xs text-muted-foreground font-medium uppercase tracking-wider">{{ t('tools.entityManager.splitModal.newNames') }}</p>
          <div v-for="(name, idx) in newNames" :key="idx" class="flex items-center gap-2">
            <input
              :value="name"
              type="text"
              :placeholder="t('tools.entityManager.splitModal.namePlaceholder')"
              class="flex-1 h-9 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              @input="updateName(idx, $event)"
            />
            <button
              v-if="newNames.length > 2"
              class="h-9 w-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
              @click="removeName(idx)"
            >
              <Trash2 class="h-4 w-4" />
            </button>
          </div>
          <button class="flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors" @click="addName">
            <Plus class="h-4 w-4" />
            {{ t('tools.entityManager.splitModal.addAnother') }}
          </button>
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
          :disabled="loading || !isValid()"
          @click="handleConfirm"
        >
          {{ t('tools.entityManager.actions.split') }}
        </button>
      </div>
    </div>
  </div>
</template>
