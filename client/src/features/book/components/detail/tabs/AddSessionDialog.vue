<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { X } from '@lucide/vue'

const props = defineProps<{
  open: boolean
  formats: string[]
  saving: boolean
  error: string | null
}>()

const emit = defineEmits<{
  close: []
  submit: [payload: { startedAt: string; durationMinutes: number; endProgress?: number; format?: string }]
}>()

const startedAt = ref('')
const durationMinutes = ref(30)
const endProgress = ref<number | null>(null)
const format = ref('')
const localError = ref<string | null>(null)

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const maxStartedAt = computed(() => toLocalInputValue(new Date()))

watch(
  () => props.open,
  (open) => {
    if (!open) return
    const now = new Date()
    now.setMinutes(now.getMinutes() - (now.getMinutes() % 5), 0, 0)
    startedAt.value = toLocalInputValue(now)
    durationMinutes.value = 30
    endProgress.value = null
    format.value = ''
    localError.value = null
  },
)

function handleClose() {
  if (props.saving) return
  emit('close')
}

function handleSubmit() {
  localError.value = null
  const parsed = new Date(startedAt.value)
  if (!startedAt.value || Number.isNaN(parsed.getTime())) {
    localError.value = 'Pick a valid date and time.'
    return
  }
  if (parsed.getTime() > Date.now()) {
    localError.value = 'The session cannot start in the future.'
    return
  }
  if (!Number.isInteger(durationMinutes.value) || durationMinutes.value < 1 || durationMinutes.value > 1440) {
    localError.value = 'Duration must be between 1 and 1440 minutes.'
    return
  }
  if (endProgress.value != null && (endProgress.value < 0 || endProgress.value > 100)) {
    localError.value = 'End progress must be between 0 and 100.'
    return
  }
  emit('submit', {
    startedAt: parsed.toISOString(),
    durationMinutes: durationMinutes.value,
    ...(endProgress.value != null ? { endProgress: endProgress.value } : {}),
    ...(format.value ? { format: format.value } : {}),
  })
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="handleClose" />
      <div class="relative z-10 w-full max-w-md mx-4 bg-card border border-border rounded-lg shadow-2xl p-6">
        <div class="flex items-center justify-between mb-5">
          <h2 class="text-base font-semibold text-foreground">Add reading session</h2>
          <button class="text-muted-foreground hover:text-foreground transition-colors" @click="handleClose">
            <X :size="18" />
          </button>
        </div>

        <form class="flex flex-col gap-4" @submit.prevent="handleSubmit">
          <div class="flex flex-col gap-1.5">
            <label class="text-sm font-medium text-foreground">Started at</label>
            <input
              v-model="startedAt"
              type="datetime-local"
              :max="maxStartedAt"
              class="h-9 rounded-md border border-input bg-background text-foreground text-sm px-3 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div class="flex flex-col gap-1.5">
              <label class="text-sm font-medium text-foreground">Duration (minutes)</label>
              <input
                v-model.number="durationMinutes"
                type="number"
                min="1"
                max="1440"
                class="h-9 rounded-md border border-input bg-background text-foreground text-sm px-3 focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="text-sm font-medium text-foreground">End progress %</label>
              <input
                v-model.number="endProgress"
                type="number"
                min="0"
                max="100"
                step="0.1"
                placeholder="Optional"
                class="h-9 rounded-md border border-input bg-background text-foreground text-sm px-3 focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground"
              />
            </div>
          </div>

          <div v-if="formats.length >= 2" class="flex flex-col gap-1.5">
            <label class="text-sm font-medium text-foreground">Format</label>
            <select
              v-model="format"
              class="h-9 rounded-md border border-input bg-background text-foreground text-sm px-3 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">No specific format</option>
              <option v-for="fmt in formats" :key="fmt" :value="fmt">{{ fmt.toUpperCase() }}</option>
            </select>
          </div>

          <p v-if="localError || error" class="text-sm text-destructive">{{ localError ?? error }}</p>

          <div class="flex justify-end gap-2 mt-1">
            <button
              type="button"
              class="h-9 px-4 rounded-md border border-input bg-background text-sm text-foreground hover:bg-muted transition-colors"
              @click="handleClose"
            >
              Cancel
            </button>
            <button
              type="submit"
              :disabled="saving"
              class="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {{ saving ? 'Saving...' : 'Add session' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>
