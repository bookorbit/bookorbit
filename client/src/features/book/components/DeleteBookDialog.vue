<script setup lang="ts">
import { Loader2, Trash2 } from 'lucide-vue-next'

defineProps<{ open: boolean; deleting: boolean }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="emit('cancel')" />
      <div class="relative z-10 w-full max-w-sm mx-4 bg-card border border-border rounded-xl shadow-2xl p-6">
        <div class="flex items-start gap-4 mb-5">
          <div class="shrink-0 h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center">
            <Trash2 class="text-destructive" :size="18" />
          </div>
          <div>
            <h2 class="text-base font-semibold text-foreground">Delete book?</h2>
            <p class="text-sm text-muted-foreground mt-1">
              This will permanently delete the book and all its metadata, files, reading progress, and bookmarks. This cannot be undone.
            </p>
          </div>
        </div>
        <div class="flex justify-end gap-2">
          <button
            class="h-9 px-4 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            :disabled="deleting"
            @click="emit('cancel')"
          >
            Cancel
          </button>
          <button
            class="h-9 px-4 rounded-md text-sm font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors flex items-center gap-2 disabled:opacity-50"
            :disabled="deleting"
            @click="emit('confirm')"
          >
            <Loader2 v-if="deleting" class="animate-spin" :size="14" />
            Delete
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
