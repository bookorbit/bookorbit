<script setup lang="ts">
import { AlertTriangle } from 'lucide-vue-next'

defineProps<{
  open: boolean
  renameCount: number
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

function handleConfirm(): void {
  emit('confirm')
}

function handleCancel(): void {
  emit('cancel')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="handleCancel">
      <div class="bg-card border rounded-lg shadow-lg w-full max-w-md mx-4 p-6">
        <div class="flex items-start gap-3 mb-4">
          <div class="flex-shrink-0 w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <AlertTriangle class="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h3 class="text-lg font-semibold text-foreground">Confirm Bulk Rename</h3>
            <p class="mt-1 text-sm text-muted-foreground">
              This will rename <strong>{{ renameCount }}</strong> book{{ renameCount === 1 ? '' : 's' }} on disk. Files with collisions or errors will
              be skipped. This action cannot be undone.
            </p>
          </div>
        </div>

        <div class="flex justify-end gap-2">
          <button class="px-4 py-2 text-sm font-medium rounded-md border hover:bg-muted transition-colors" @click="handleCancel">Cancel</button>
          <button
            class="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            @click="handleConfirm"
          >
            Rename {{ renameCount }} book{{ renameCount === 1 ? '' : 's' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
