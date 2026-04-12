<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { X, Zap } from 'lucide-vue-next'
import { api } from '@/lib/api'
import type { GroupRule, Lens, Rule, SortSpec } from '@projectx/types'
import { useLenses } from '@/features/lens/composables/useLenses'
import BookFilterBuilder from '@/features/book/components/BookFilterBuilder.vue'
import BookSortBuilder from '@/features/book/components/BookSortBuilder.vue'
import IconPicker from '@/components/IconPicker.vue'

const TEMPLATES: { label: string; build: () => GroupRule }[] = [
  {
    label: 'Has Series',
    build: () => ({ type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'series', operator: 'isNotEmpty' } as Rule] }),
  },
  {
    label: 'Added Recently',
    build: () => ({ type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'addedAt', operator: 'withinLast', value: 30 } as Rule] }),
  },
  {
    label: 'PDF Only',
    build: () => ({ type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'format', operator: 'includesAny', value: ['pdf'] } as Rule] }),
  },
  {
    label: 'No Genres',
    build: () => ({ type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'genre', operator: 'isEmpty' } as Rule] }),
  },
  {
    label: 'EPUB Only',
    build: () => ({ type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'format', operator: 'includesAny', value: ['epub'] } as Rule] }),
  },
]

const props = defineProps<{
  open: boolean
  lens: Lens | null | undefined
}>()

const emit = defineEmits<{
  close: []
  saved: []
}>()

const { updateLens } = useLenses()

const draftName = ref('')
const draftIcon = ref('')
const draftFilter = ref<GroupRule | undefined>(undefined)
const draftSort = ref<SortSpec[]>([])
const saving = ref(false)
const saveError = ref<string | null>(null)
const trimmedDraftName = computed(() => draftName.value.trim())
const trimmedDraftIcon = computed(() => draftIcon.value.trim())

const previewCount = ref<number | null>(null)
const previewLoading = ref(false)
let previewTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && props.lens) {
      draftName.value = props.lens.name
      draftIcon.value = props.lens.icon ?? ''
      draftFilter.value = props.lens.filter ?? undefined
      draftSort.value = props.lens.defaultSort ? [...props.lens.defaultSort] : []
      schedulePreview()
    }
  },
)

function schedulePreview() {
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(fetchPreview, 450)
}

watch([draftFilter, draftSort], schedulePreview, { deep: true })

async function fetchPreview() {
  previewLoading.value = true
  try {
    const body: Record<string, unknown> = {
      sort: draftSort.value,
      pagination: { page: 0, size: 1 },
    }
    if (draftFilter.value) body.filter = draftFilter.value
    const res = await api('/api/v1/books/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    previewCount.value = res.ok ? (await res.json()).total : null
  } catch {
    previewCount.value = null
  } finally {
    previewLoading.value = false
  }
}

function applyTemplate(t: (typeof TEMPLATES)[number]) {
  draftFilter.value = t.build()
}

function initFilter() {
  draftFilter.value = { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains' }] }
}

async function save() {
  if (!props.lens) return
  if (!trimmedDraftName.value) {
    saveError.value = 'Name is required'
    return
  }
  if (!trimmedDraftIcon.value) {
    saveError.value = 'Choose an icon'
    return
  }
  saving.value = true
  saveError.value = null
  try {
    await updateLens(props.lens.id, {
      name: trimmedDraftName.value,
      icon: trimmedDraftIcon.value,
      filter: draftFilter.value,
      defaultSort: draftSort.value,
    })
    emit('saved')
    emit('close')
  } catch {
    saveError.value = 'Failed to save'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="lens-fade">
      <div v-if="open" class="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" @click="emit('close')" />
    </Transition>

    <Transition name="lens-slide">
      <div v-if="open" class="fixed inset-y-0 right-0 z-50 flex flex-col w-full sm:w-[750px] bg-card border-l border-border shadow-2xl">
        <!-- Header -->
        <div class="flex items-start gap-4 px-6 py-5 border-b border-border shrink-0">
          <div class="flex-1 min-w-0">
            <h2 class="text-base font-semibold text-foreground leading-tight truncate">
              {{ draftName || 'Untitled Lens' }}
            </h2>
            <p class="text-xs text-muted-foreground mt-0.5">Configure lens settings</p>
          </div>
          <div class="flex items-center gap-2 shrink-0 mt-0.5">
            <span
              v-if="previewCount !== null || previewLoading"
              class="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium transition-all"
              :class="previewLoading ? 'border-border text-muted-foreground' : 'border-primary/30 bg-primary/8 text-primary'"
            >
              <span v-if="previewLoading" class="animate-pulse">counting...</span>
              <template v-else>{{ previewCount?.toLocaleString() }} books</template>
            </span>
            <button
              @click="emit('close')"
              class="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X :size="16" />
            </button>
          </div>
        </div>

        <!-- Scrollable body -->
        <div class="flex-1 overflow-y-auto px-6 py-6 flex flex-col gap-5">
          <!-- Identity card -->
          <div class="rounded-xl border border-border bg-background p-5 flex flex-col gap-4">
            <h3 class="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Identity</h3>
            <div class="flex gap-3">
              <div class="flex-1 flex flex-col gap-1.5">
                <label class="text-xs font-medium text-foreground/70">Name</label>
                <input
                  v-model="draftName"
                  type="text"
                  placeholder="e.g. Unread Sci-Fi"
                  class="h-10 rounded-lg border border-input bg-card text-foreground text-sm px-3 focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground/60"
                />
              </div>
              <div class="flex-1 flex flex-col gap-1.5">
                <label class="text-xs font-medium text-foreground/70">Icon</label>
                <IconPicker v-model="draftIcon" placeholder="Choose an icon..." />
              </div>
            </div>
          </div>

          <!-- Filters card -->
          <div class="rounded-xl border border-border bg-background p-5 flex flex-col gap-4">
            <h3 class="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Filters</h3>

            <!-- Empty state -->
            <template v-if="!draftFilter">
              <p class="text-sm text-muted-foreground leading-relaxed">No filters set. All accessible books will be included in this lens.</p>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="t in TEMPLATES"
                  :key="t.label"
                  @click="applyTemplate(t)"
                  class="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-dashed border-border bg-muted/30 text-foreground hover:border-primary hover:bg-primary/5 hover:text-primary transition-colors"
                >
                  <Zap :size="11" class="shrink-0" />
                  {{ t.label }}
                </button>
              </div>
              <button
                @click="initFilter"
                class="self-start flex items-center gap-1.5 h-9 px-4 rounded-lg border border-input bg-card text-sm text-foreground hover:bg-muted transition-colors"
              >
                Build from scratch
              </button>
            </template>

            <!-- Filter builder -->
            <template v-else>
              <BookFilterBuilder v-model="draftFilter" />
              <div class="flex flex-wrap items-center gap-1.5 pt-3 border-t border-border/50">
                <span class="text-xs text-muted-foreground shrink-0">Replace with template:</span>
                <button
                  v-for="t in TEMPLATES"
                  :key="t.label"
                  @click="applyTemplate(t)"
                  class="text-xs px-2.5 py-1 rounded-full border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                >
                  {{ t.label }}
                </button>
              </div>
            </template>
          </div>

          <!-- Sort card -->
          <div class="rounded-xl border border-border bg-background p-5 flex flex-col gap-4">
            <h3 class="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Default Sort</h3>
            <BookSortBuilder v-model="draftSort" />
          </div>
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-between px-6 py-4 border-t border-border shrink-0 gap-3">
          <p v-if="saveError" class="text-xs text-destructive">{{ saveError }}</p>
          <div v-else class="flex-1" />
          <div class="flex items-center gap-2 shrink-0">
            <button
              @click="emit('close')"
              class="h-10 px-5 rounded-lg border border-input bg-card text-sm text-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              @click="save"
              :disabled="!trimmedDraftName || !trimmedDraftIcon || saving"
              class="h-10 px-6 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {{ saving ? 'Saving...' : 'Save changes' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.lens-fade-enter-active,
.lens-fade-leave-active {
  transition: opacity 0.2s ease;
}
.lens-fade-enter-from,
.lens-fade-leave-to {
  opacity: 0;
}

.lens-slide-enter-active,
.lens-slide-leave-active {
  transition: transform 0.25s ease;
}
.lens-slide-enter-from,
.lens-slide-leave-to {
  transform: translateX(100%);
}
</style>
