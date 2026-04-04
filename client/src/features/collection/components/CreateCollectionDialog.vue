<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { X } from 'lucide-vue-next'
import { useCollections } from '../composables/useCollections'
import IconPicker from '@/components/IconPicker.vue'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const router = useRouter()
const { createCollection } = useCollections()

const name = ref('')
const icon = ref('')
const saving = ref(false)
const error = ref<string | null>(null)
const trimmedName = computed(() => name.value.trim())
const trimmedIcon = computed(() => icon.value.trim())

async function submit() {
  if (!trimmedName.value) {
    error.value = 'Name is required'
    return
  }
  if (!trimmedIcon.value) {
    error.value = 'Choose an icon'
    return
  }
  saving.value = true
  error.value = null
  try {
    const collection = await createCollection(trimmedName.value, trimmedIcon.value)
    name.value = ''
    icon.value = ''
    emit('close')
    router.push({ name: 'collection', params: { id: collection.id } })
  } catch {
    error.value = 'Failed to create collection'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="emit('close')" />
      <div class="relative z-10 w-full max-w-md mx-4 bg-card border border-border rounded-xl shadow-2xl p-6">
        <div class="flex items-center justify-between mb-5">
          <h2 class="text-base font-semibold text-foreground">New Collection</h2>
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
              placeholder="e.g. Favorites"
              autofocus
              class="h-9 rounded-md border border-input bg-background text-foreground text-sm px-3 focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground"
            />
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-sm font-medium text-foreground">Icon</label>
            <IconPicker v-model="icon" placeholder="Choose an icon..." />
          </div>

          <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

          <div class="flex justify-end gap-2 mt-1">
            <button
              type="button"
              @click="emit('close')"
              class="h-9 px-4 rounded-md border border-input bg-background text-sm text-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              :disabled="!trimmedName || !trimmedIcon || saving"
              class="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {{ saving ? 'Creating...' : 'Create' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>
