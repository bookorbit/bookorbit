<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Check, ChevronDown, Search } from '@lucide/vue'
import type { TaxonomyKind, TaxonomySummary } from '@bookorbit/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatNumber } from '@/i18n/formatters'
import { fetchTaxonomyPage } from '../api/taxonomy'
import { taxonomyRouteNames } from '../lib/taxonomy-text'

/** The page title as a jump list: the biggest names first, narrowed by a server search. */
const props = defineProps<{
  kind: TaxonomyKind
  id: number
  title: string
  libraryId?: number | null
}>()

const { t } = useI18n()
const router = useRouter()

const SIZE = 40
const DEBOUNCE_MS = 200

const open = ref(false)
const query = ref('')
const items = ref<TaxonomySummary[]>([])
const loading = ref(false)
const listRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)

let token = 0
let timer: ReturnType<typeof setTimeout> | null = null

async function search() {
  const current = ++token
  loading.value = true
  try {
    const page = await fetchTaxonomyPage(props.kind, { q: query.value.trim() || undefined, page: 0, size: SIZE, sort: 'bookCount', order: 'desc' })
    if (current === token) items.value = page.items
  } catch {
    if (current === token) items.value = []
  } finally {
    if (current === token) loading.value = false
  }
}

function itemButtons(): HTMLButtonElement[] {
  return Array.from(listRef.value?.querySelectorAll<HTMLButtonElement>('[data-switch-item]') ?? [])
}

function handleOpenChange(value: boolean) {
  open.value = value
  if (!value) return
  query.value = ''
  void search()
  void nextTick(() => inputRef.value?.focus())
}

function handleOpenAutoFocus(event: Event) {
  event.preventDefault()
}

function handleQueryInput(event: Event) {
  query.value = (event.target as HTMLInputElement).value
  if (timer) clearTimeout(timer)
  timer = setTimeout(search, DEBOUNCE_MS)
}

function handleInputKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    itemButtons()[0]?.focus()
  } else if (event.key === 'Enter') {
    event.preventDefault()
    itemButtons()[0]?.click()
  }
}

function handleListKeydown(event: KeyboardEvent) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
  const buttons = itemButtons()
  if (buttons.length === 0) return
  event.preventDefault()
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  if (event.key === 'Home') buttons[0]?.focus()
  else if (event.key === 'End') buttons[buttons.length - 1]?.focus()
  else if (event.key === 'ArrowDown') buttons[Math.min(buttons.length - 1, index + 1)]?.focus()
  else if (index <= 0) inputRef.value?.focus()
  else buttons[index - 1]?.focus()
}

function go(id: number) {
  open.value = false
  if (id === props.id) return
  void router.push({
    name: taxonomyRouteNames(props.kind).detail,
    params: { id },
    query: props.libraryId ? { libraryId: String(props.libraryId) } : undefined,
  })
}

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <Popover :open="open" @update:open="handleOpenChange">
    <PopoverTrigger as-child>
      <button
        type="button"
        class="-mx-1.5 flex min-w-0 items-center gap-1.5 rounded-[7px] px-1.5 text-start transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
        :class="open ? 'bg-muted' : ''"
        :aria-label="t('components.browseHeader.switcher.open', { name: title })"
      >
        <span class="truncate text-[19px] leading-[25px] font-bold tracking-[-0.015em] text-foreground sm:text-[22px] sm:leading-[27px]">{{
          title
        }}</span>
        <ChevronDown
          :size="16"
          :stroke-width="2.25"
          class="mt-0.5 shrink-0 text-muted-foreground transition-transform"
          :class="open ? 'rotate-180' : ''"
        />
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" :side-offset="6" class="w-[280px] p-1.5" @open-auto-focus="handleOpenAutoFocus">
      <div class="-mx-1.5 -mt-1.5 mb-1 flex h-10 items-center gap-2 border-b border-border px-3 text-muted-foreground">
        <Search :size="14" aria-hidden="true" />
        <input
          ref="inputRef"
          :value="query"
          type="text"
          class="h-full min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          :placeholder="kind === 'tag' ? t('taxonomy.page.findTag') : t('taxonomy.page.findGenre')"
          :aria-label="kind === 'tag' ? t('taxonomy.page.findTag') : t('taxonomy.page.findGenre')"
          @input="handleQueryInput"
          @keydown="handleInputKeydown"
        />
      </div>
      <div ref="listRef" class="max-h-[min(60vh,440px)] overflow-y-auto" :aria-busy="loading" @keydown="handleListKeydown">
        <p v-if="!loading && items.length === 0" class="px-2.5 py-3 text-[13px] text-muted-foreground">
          {{ t('components.browseHeader.switcher.empty') }}
        </p>
        <button
          v-for="item in items"
          :key="item.id"
          data-switch-item
          type="button"
          class="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-start text-[13px] text-foreground transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
          :class="item.id === id ? 'bg-muted' : ''"
          :aria-current="item.id === id ? 'page' : undefined"
          @click="go(item.id)"
        >
          <span class="min-w-0 flex-1 truncate" :class="item.id === id ? 'font-semibold text-primary' : ''">{{ item.name }}</span>
          <Check v-if="item.id === id" :size="14" :stroke-width="2.25" class="shrink-0 text-primary" aria-hidden="true" />
          <span v-else class="text-[12.5px] text-muted-foreground tabular-nums">{{ formatNumber(item.bookCount) }}</span>
        </button>
      </div>
    </PopoverContent>
  </Popover>
</template>
