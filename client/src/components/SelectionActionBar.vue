<script setup lang="ts">
import { ref, watch } from 'vue'
import { FolderMinus, FolderPlus, Trash2, X } from 'lucide-vue-next'

const props = defineProps<{
  count: number
  visible: boolean
  inCollection?: boolean
}>()

const emit = defineEmits<{
  'add-to-collection': []
  'remove-from-collection': []
  delete: []
  exit: []
}>()

const confirmingDelete = ref(false)

watch(
  () => props.visible,
  (v) => {
    if (!v) confirmingDelete.value = false
  },
)
</script>

<template>
  <Transition
    enter-active-class="transition-all duration-200 ease-out"
    enter-from-class="opacity-0 translate-y-4"
    enter-to-class="opacity-100 translate-y-0"
    leave-active-class="transition-all duration-150 ease-in"
    leave-from-class="opacity-100 translate-y-0"
    leave-to-class="opacity-0 translate-y-4"
  >
    <div
      v-if="visible"
      class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 px-2 py-1.5 rounded-full bg-card border border-border shadow-xl"
    >
      <template v-if="!confirmingDelete">
        <!-- Count -->
        <span class="px-3 text-sm font-semibold text-foreground tabular-nums whitespace-nowrap"> {{ count }} selected </span>

        <div class="w-px h-5 bg-border mx-1 shrink-0" />

        <!-- Add to Collection -->
        <button
          :disabled="count === 0"
          class="flex items-center gap-1.5 h-8 px-3 rounded-full text-sm font-medium transition-colors"
          :class="count > 0 ? 'text-foreground hover:bg-primary hover:text-primary-foreground' : 'text-muted-foreground/40 cursor-not-allowed'"
          title="Add to Collection"
          @click="emit('add-to-collection')"
        >
          <FolderPlus :size="14" />
          <span class="hidden sm:inline">Add to Collection</span>
        </button>

        <!-- Remove from Collection (only inside a collection view) -->
        <button
          v-if="inCollection"
          :disabled="count === 0"
          class="flex items-center gap-1.5 h-8 px-3 rounded-full text-sm font-medium transition-colors"
          :class="
            count > 0 ? 'text-destructive hover:bg-destructive hover:text-destructive-foreground' : 'text-muted-foreground/40 cursor-not-allowed'
          "
          title="Remove from Collection"
          @click="emit('remove-from-collection')"
        >
          <FolderMinus :size="14" />
          <span class="hidden sm:inline">Remove</span>
        </button>

        <!-- Delete -->
        <button
          :disabled="count === 0"
          class="flex items-center gap-1.5 h-8 px-3 rounded-full text-sm font-medium transition-colors"
          :class="
            count > 0 ? 'text-destructive hover:bg-destructive hover:text-destructive-foreground' : 'text-muted-foreground/40 cursor-not-allowed'
          "
          title="Delete selected"
          @click="confirmingDelete = true"
        >
          <Trash2 :size="14" />
          <span class="hidden sm:inline">Delete</span>
        </button>

        <div class="w-px h-5 bg-border mx-1 shrink-0" />

        <!-- Exit selection mode -->
        <button
          class="h-8 w-8 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Exit selection"
          @click="emit('exit')"
        >
          <X :size="14" />
        </button>
      </template>

      <template v-else>
        <!-- Confirm delete -->
        <span class="px-3 text-sm font-semibold text-destructive whitespace-nowrap"> Delete {{ count }} book{{ count === 1 ? '' : 's' }}? </span>

        <div class="w-px h-5 bg-border mx-1 shrink-0" />

        <button
          class="flex items-center h-8 px-3 rounded-full text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          @click="confirmingDelete = false"
        >
          Cancel
        </button>

        <button
          class="flex items-center gap-1.5 h-8 px-3 rounded-full text-sm font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
          @click="emit('delete'); confirmingDelete = false"
        >
          <Trash2 :size="14" />
          Delete
        </button>
      </template>
    </div>
  </Transition>
</template>
