<script setup lang="ts">
import { computed, ref, watch } from 'vue'

type TagMode = 'add' | 'remove' | 'replace'

const props = defineProps<{
  open: boolean
  bookCount: number
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  confirm: [mode: TagMode, tags: string[]]
}>()

const mode = ref<TagMode>('add')
const tagInput = ref('')

const parsedTags = computed(() =>
  tagInput.value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean),
)

const canConfirm = computed(() => mode.value === 'replace' || parsedTags.value.length > 0)

const modeLabel: Record<TagMode, string> = {
  add: 'Add tags',
  remove: 'Remove tags',
  replace: 'Replace all',
}

const modeDescription: Record<TagMode, string> = {
  add: 'Merge these tags into existing tags on each selected book.',
  remove: 'Remove these tags from each selected book where they exist.',
  replace: 'Replace all existing tags on each selected book with these tags.',
}

function handleConfirm() {
  if (!canConfirm.value) return
  emit('confirm', mode.value, parsedTags.value)
  handleClose()
}

function resetForm() {
  tagInput.value = ''
  mode.value = 'add'
}

function handleClose() {
  emit('update:open', false)
  resetForm()
}

watch(
  () => props.open,
  (open) => {
    if (!open) resetForm()
  },
)
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="handleClose" />
      <div class="relative z-10 w-full max-w-sm mx-4 bg-card border border-border rounded-xl shadow-2xl p-6">
        <h2 class="text-base font-semibold text-foreground mb-4">Edit tags - {{ bookCount }} book{{ bookCount === 1 ? '' : 's' }}</h2>

        <div class="space-y-4">
          <div class="flex gap-2">
            <button
              v-for="m in ['add', 'remove', 'replace'] as TagMode[]"
              :key="m"
              type="button"
              :class="[
                'flex-1 py-1.5 rounded-md text-sm font-medium transition-colors',
                mode === m ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
              ]"
              @click="mode = m"
            >
              {{ modeLabel[m] }}
            </button>
          </div>

          <p class="text-sm text-muted-foreground">{{ modeDescription[mode] }}</p>

          <div class="space-y-1.5">
            <label class="text-sm font-medium text-foreground" for="bulk-tag-input">Tags (comma-separated)</label>
            <input
              id="bulk-tag-input"
              v-model="tagInput"
              class="w-full h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              :placeholder="mode === 'replace' ? 'Leave empty to clear all tags, or enter tags to replace them' : 'sci-fi, classics, favorites'"
            />
            <p v-if="parsedTags.length > 0" class="text-xs text-muted-foreground">
              {{ parsedTags.length }} tag{{ parsedTags.length === 1 ? '' : 's' }}: {{ parsedTags.join(', ') }}
            </p>
            <p v-else-if="mode === 'replace'" class="text-xs text-muted-foreground">Apply with no tags to clear all tags on the selected books.</p>
          </div>
        </div>

        <div class="flex justify-end gap-2 mt-6">
          <button
            type="button"
            class="h-9 px-4 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            @click="handleClose"
          >
            Cancel
          </button>
          <button
            type="button"
            :disabled="!canConfirm"
            class="h-9 px-4 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            @click="handleConfirm"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
