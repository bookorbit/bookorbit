<script setup lang="ts">
import { ref } from 'vue'
import { Save, X } from '@lucide/vue'

const props = withDefaults(
  defineProps<{
    initialNote: string | null
    saving?: boolean
  }>(),
  { saving: false },
)

const emit = defineEmits<{
  save: [note: string | null]
  cancel: []
}>()

const noteText = ref(props.initialNote ?? '')

function handleSave() {
  if (props.saving) return
  const trimmed = noteText.value.trim()
  emit('save', trimmed || null)
}

function handleCancel() {
  if (props.saving) return
  emit('cancel')
}
</script>

<template>
  <div class="mt-2 space-y-2">
    <textarea
      v-model="noteText"
      placeholder="Add a note..."
      rows="3"
      :disabled="saving"
      class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-y"
    />
    <div class="flex items-center gap-2 justify-end">
      <button
        type="button"
        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        :disabled="saving"
        @click="handleCancel"
      >
        <X :size="14" />
        Cancel
      </button>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        :disabled="saving"
        @click="handleSave"
      >
        <Save :size="14" />
        {{ saving ? 'Saving' : 'Save' }}
      </button>
    </div>
  </div>
</template>
