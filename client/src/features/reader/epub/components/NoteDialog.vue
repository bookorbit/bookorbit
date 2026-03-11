<script setup lang="ts">
defineProps<{ selectedText: string; modelValue: string }>()
const emit = defineEmits<{ save: [note: string]; cancel: []; 'update:modelValue': [value: string] }>()
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50" @click.self="emit('cancel')">
      <div class="bg-card text-card-foreground rounded-xl shadow-2xl p-4 w-full max-w-sm flex flex-col gap-3">
        <p class="text-sm font-medium">Add note</p>
        <p class="text-xs text-muted-foreground line-clamp-2 italic">"{{ selectedText }}"</p>
        <textarea
          :value="modelValue"
          @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
          class="w-full rounded-lg border border-border bg-background text-foreground text-sm p-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
          rows="4"
          placeholder="Write your note…"
          autofocus
        />
        <div class="flex gap-2 justify-end">
          <button class="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors" @click="emit('cancel')">
            Cancel
          </button>
          <button
            class="px-3 py-1.5 rounded-lg text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            @click="emit('save', modelValue)"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
