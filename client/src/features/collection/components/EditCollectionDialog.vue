<script setup lang="ts">
import { ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import { useCollections } from '../composables/useCollections'
import IconPicker from '@/components/IconPicker.vue'
import type { Collection } from '@projectx/types'

const props = defineProps<{ open: boolean; collection: Collection }>()
const emit = defineEmits<{ close: []; deleted: [id: number] }>()

const { updateCollection, deleteCollection } = useCollections()

const name = ref('')
const icon = ref('')
const syncToKobo = ref(false)
const saving = ref(false)
const deleting = ref(false)
const error = ref<string | null>(null)

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      name.value = props.collection.name
      icon.value = props.collection.icon ?? ''
      syncToKobo.value = props.collection.syncToKobo
      error.value = null
    }
  },
)

async function submit() {
  if (!name.value.trim()) return
  saving.value = true
  error.value = null
  try {
    await updateCollection(props.collection.id, name.value.trim(), icon.value, syncToKobo.value)
    emit('close')
  } catch {
    error.value = 'Failed to update collection'
  } finally {
    saving.value = false
  }
}

async function handleDelete() {
  if (!confirm(`Delete collection "${props.collection.name}"? This cannot be undone.`)) return
  deleting.value = true
  error.value = null
  try {
    await deleteCollection(props.collection.id)
    emit('deleted', props.collection.id)
    emit('close')
  } catch {
    error.value = 'Failed to delete collection'
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="emit('close')" />
      <div class="relative z-10 w-full max-w-md mx-4 bg-card border border-border rounded-xl shadow-2xl p-6">
        <div class="flex items-center justify-between mb-5">
          <h2 class="text-base font-semibold text-foreground">Edit Collection</h2>
          <button @click="emit('close')" class="text-muted-foreground hover:text-foreground transition-colors">
            <X :size="18" />
          </button>
        </div>

        <form @submit.prevent="submit" class="flex flex-col gap-4">
          <div class="flex flex-col gap-1.5">
            <label class="text-sm font-medium text-foreground">Name</label>
            <input
              v-model="name"
              type="text"
              autofocus
              class="h-9 rounded-md border border-input bg-background text-foreground text-sm px-3 focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground"
            />
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-sm font-medium text-foreground"> Icon <span class="text-muted-foreground font-normal">(optional)</span> </label>
            <IconPicker v-model="icon" placeholder="Choose an icon..." />
          </div>

          <div class="flex items-center justify-between py-1">
            <div>
              <p class="text-sm font-medium text-foreground">Sync to Kobo</p>
              <p class="text-xs text-muted-foreground mt-0.5">Books in this collection will appear on your Kobo device</p>
            </div>
            <button
              type="button"
              class="w-11 h-6 rounded-full transition-colors relative shrink-0"
              :class="syncToKobo ? 'bg-primary' : 'bg-muted'"
              @click="syncToKobo = !syncToKobo"
            >
              <div
                class="absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm"
                :class="syncToKobo ? 'translate-x-6' : 'translate-x-1'"
              />
            </button>
          </div>

          <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

          <div class="flex items-center justify-between gap-2 mt-1">
            <button
              type="button"
              :disabled="saving || deleting"
              class="h-9 px-4 rounded-md border border-destructive/30 bg-destructive/10 text-sm font-medium text-destructive hover:bg-destructive/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              @click="handleDelete"
            >
              {{ deleting ? 'Deleting...' : 'Delete collection' }}
            </button>

            <button
              type="button"
              @click="emit('close')"
              class="h-9 px-4 rounded-md border border-input bg-background text-sm text-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              :disabled="!name.trim() || saving || deleting"
              class="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {{ saving ? 'Saving...' : 'Save' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>
