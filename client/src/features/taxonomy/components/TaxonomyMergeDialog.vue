<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { Check, GitMerge, Search, X } from '@lucide/vue'
import type { TaxonomyKind, TaxonomyName, TaxonomySummary } from '@bookorbit/types'
import { fetchTaxonomyPage } from '../api/taxonomy'

/**
 * Folds this name into another one picked from a search, the Entity Manager's merge from the
 * other side: here the name being merged away is fixed and the reader chooses where it goes.
 */
const props = defineProps<{
  open: boolean
  kind: TaxonomyKind
  source: TaxonomyName
  busy: boolean
}>()

const emit = defineEmits<{
  confirm: [target: TaxonomyName, writeFiles: boolean]
  cancel: []
}>()

const { t } = useI18n()

const SIZE = 40
const DEBOUNCE_MS = 200

const query = ref('')
const candidates = ref<TaxonomySummary[]>([])
const loading = ref(false)
const targetId = ref<number | null>(null)
const writeFiles = ref(false)

let token = 0
let timer: ReturnType<typeof setTimeout> | null = null

const target = computed(() => candidates.value.find((item) => item.id === targetId.value) ?? null)
const others = computed(() => candidates.value.filter((item) => item.id !== props.source.id))

async function search() {
  const current = ++token
  loading.value = true
  try {
    const page = await fetchTaxonomyPage(props.kind, { q: query.value.trim() || undefined, page: 0, size: SIZE, sort: 'bookCount', order: 'desc' })
    if (current !== token) return
    const picked = target.value
    candidates.value = picked && !page.items.some((item) => item.id === picked.id) ? [picked, ...page.items] : page.items
  } catch {
    if (current === token) candidates.value = []
  } finally {
    if (current === token) loading.value = false
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    query.value = ''
    targetId.value = null
    writeFiles.value = false
    candidates.value = []
    void search()
  },
  { immediate: true },
)

function handleQueryInput(event: Event) {
  query.value = (event.target as HTMLInputElement).value
  if (timer) clearTimeout(timer)
  timer = setTimeout(search, DEBOUNCE_MS)
}

function selectTarget(id: number) {
  targetId.value = id
}

function handleOpenChange(open: boolean) {
  if (!open && !props.busy) emit('cancel')
}

function handleConfirm() {
  if (target.value) emit('confirm', { id: target.value.id, name: target.value.name, bookCount: target.value.bookCount }, writeFiles.value)
}

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <DialogRoot :open="open" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-scrim" />
      <DialogContent
        class="fixed top-1/2 left-1/2 z-50 flex h-150 max-h-[85vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg focus-visible:outline-none"
      >
        <div class="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <DialogTitle class="flex items-center gap-2 text-base font-semibold">
            <GitMerge class="size-5 text-primary" aria-hidden="true" />
            {{ kind === 'tag' ? t('taxonomy.page.mergeTag') : t('taxonomy.page.mergeGenre') }}
          </DialogTitle>
          <DialogClose class="text-muted-foreground transition-colors hover:text-foreground" :aria-label="t('common.close')">
            <X class="size-5" aria-hidden="true" />
          </DialogClose>
        </div>

        <div class="flex min-h-0 flex-1 flex-col overflow-hidden px-5 py-4">
          <DialogDescription class="mb-4 shrink-0 text-sm text-muted-foreground">
            {{ t('taxonomy.page.mergeDescription', { name: source.name }) }}
          </DialogDescription>

          <label
            class="mb-3 flex h-9 shrink-0 items-center gap-2 rounded-lg border border-border bg-background px-3 text-muted-foreground focus-within:ring-2 focus-within:ring-primary/30"
          >
            <Search :size="14" aria-hidden="true" />
            <input
              :value="query"
              type="text"
              class="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              :placeholder="kind === 'tag' ? t('taxonomy.page.findTag') : t('taxonomy.page.findGenre')"
              :aria-label="kind === 'tag' ? t('taxonomy.page.findTag') : t('taxonomy.page.findGenre')"
              @input="handleQueryInput"
            />
          </label>

          <div
            class="min-h-0 flex-1 overflow-y-auto pe-1"
            role="radiogroup"
            :aria-label="t('tools.entityManager.selectTargetToKeep')"
            :aria-busy="loading"
          >
            <p v-if="!loading && others.length === 0" class="py-6 text-center text-sm text-muted-foreground">{{ t('taxonomy.page.mergeNoMatch') }}</p>
            <div class="space-y-1.5">
              <button
                v-for="item in others"
                :key="item.id"
                type="button"
                role="radio"
                :aria-checked="targetId === item.id"
                class="flex w-full items-center gap-3 rounded-md border px-3 py-2 text-start transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                :class="targetId === item.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/30'"
                @click="selectTarget(item.id)"
              >
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium">{{ item.name }}</span>
                  <span class="text-xs text-muted-foreground">{{ t('tools.entityManager.bookCount', { count: item.bookCount }) }}</span>
                </span>
                <Check v-if="targetId === item.id" class="size-4 shrink-0 text-primary" aria-hidden="true" />
              </button>
            </div>
          </div>

          <label class="mt-4 flex shrink-0 cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <input v-model="writeFiles" type="checkbox" class="rounded-xs accent-primary" />
            {{ t('tools.entityManager.writeChangesToFiles') }}
          </label>
        </div>

        <div class="flex shrink-0 justify-end gap-2 border-t border-border bg-muted/20 px-5 py-3">
          <DialogClose class="h-9 rounded-lg px-4 text-sm font-medium transition-colors hover:bg-muted" :disabled="busy">
            {{ t('common.cancel') }}
          </DialogClose>
          <button
            type="button"
            class="h-9 max-w-[16rem] truncate rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
            :disabled="busy || !target"
            @click="handleConfirm"
          >
            {{ target ? t('taxonomy.page.mergeConfirm', { name: target.name }) : t('taxonomy.page.mergeConfirmEmpty') }}
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
