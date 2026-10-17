<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Check, ChevronDown, Search } from '@lucide/vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import AppIcon from '@/components/AppIcon.vue'
import { formatNumber } from '@/i18n/formatters'
import { entityCount } from '@/lib/entity-count'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useSmartScopes } from '@/features/smart-scope/composables/useSmartScopes'
import { useCollections } from '@/features/collection/composables/useCollections'
import type { BrowsePlace, BrowsePlaceKind } from './browse-header'

const props = defineProps<{
  place: BrowsePlace
  title: string
}>()

const { t } = useI18n()
const router = useRouter()
const { libraries } = useLibraries()
const { bookScopes } = useSmartScopes()
const { bookCollections } = useCollections()

const open = ref(false)
const query = ref('')
const listRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)

const ROUTE_NAME: Record<BrowsePlaceKind, string> = { library: 'library', smartScope: 'smartScope', collection: 'collection' }

interface SwitchItem {
  kind: BrowsePlaceKind
  id: number
  name: string
  icon: string | null
  fallback: string
  count: number | null
}

const groups = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  const matches = (name: string) => !needle || name.toLocaleLowerCase().includes(needle)
  const all: { kind: BrowsePlaceKind; label: string; items: SwitchItem[] }[] = [
    {
      kind: 'library',
      label: t('components.browseHeader.switcher.libraries'),
      items: libraries.value
        .filter((library) => library.type !== 'podcasts')
        .map((library) => ({
          kind: 'library',
          id: library.id,
          name: library.name,
          icon: library.icon ?? null,
          fallback: 'BookCopy',
          count: entityCount(library),
        })),
    },
    {
      kind: 'smartScope',
      label: t('components.browseHeader.switcher.smartScopes'),
      items: bookScopes.value.map((scope) => ({
        kind: 'smartScope',
        id: scope.id,
        name: scope.name,
        icon: scope.icon ?? null,
        fallback: 'Aperture',
        count: entityCount(scope),
      })),
    },
    {
      kind: 'collection',
      label: t('components.browseHeader.switcher.collections'),
      items: bookCollections.value.map((collection) => ({
        kind: 'collection',
        id: collection.id,
        name: collection.name,
        icon: collection.icon ?? null,
        fallback: 'FolderOpen',
        count: entityCount(collection),
      })),
    },
  ]
  return all.map((group) => ({ ...group, items: group.items.filter((item) => matches(item.name)) })).filter((group) => group.items.length > 0)
})

function isCurrent(item: SwitchItem) {
  return item.kind === props.place.kind && item.id === props.place.id
}

function itemButtons(): HTMLButtonElement[] {
  return Array.from(listRef.value?.querySelectorAll<HTMLButtonElement>('[data-switch-item]') ?? [])
}

function handleOpenChange(value: boolean) {
  open.value = value
  if (value) {
    query.value = ''
    void nextTick(() => inputRef.value?.focus())
  }
}

function handleOpenAutoFocus(event: Event) {
  event.preventDefault()
}

function handleQueryInput(event: Event) {
  query.value = (event.target as HTMLInputElement).value
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
  const items = itemButtons()
  if (items.length === 0) return
  event.preventDefault()
  const index = items.indexOf(document.activeElement as HTMLButtonElement)
  if (event.key === 'Home') items[0]?.focus()
  else if (event.key === 'End') items[items.length - 1]?.focus()
  else if (event.key === 'ArrowDown') items[Math.min(items.length - 1, index + 1)]?.focus()
  else if (index <= 0) inputRef.value?.focus()
  else items[index - 1]?.focus()
}

function go(item: SwitchItem) {
  open.value = false
  if (isCurrent(item)) return
  void router.push({ name: ROUTE_NAME[item.kind], params: { id: item.id } })
}
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
    <PopoverContent align="start" :side-offset="6" class="w-[300px] p-1.5" @open-auto-focus="handleOpenAutoFocus">
      <div class="-mx-1.5 -mt-1.5 mb-1 flex h-10 items-center gap-2 border-b border-border px-3 text-muted-foreground">
        <Search :size="14" aria-hidden="true" />
        <input
          ref="inputRef"
          :value="query"
          type="text"
          class="h-full min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          :placeholder="t('components.browseHeader.switcher.jumpTo')"
          :aria-label="t('components.browseHeader.switcher.jumpTo')"
          @input="handleQueryInput"
          @keydown="handleInputKeydown"
        />
      </div>
      <div ref="listRef" class="max-h-[min(60vh,440px)] overflow-y-auto" @keydown="handleListKeydown">
        <p v-if="groups.length === 0" class="px-2.5 py-3 text-[13px] text-muted-foreground">{{ t('components.browseHeader.switcher.empty') }}</p>
        <div v-for="group in groups" :key="group.kind" role="group" :aria-label="group.label">
          <p class="px-2.5 pt-2.5 pb-1 text-[10.5px] font-bold tracking-[0.08em] text-muted-foreground uppercase" aria-hidden="true">
            {{ group.label }}
          </p>
          <button
            v-for="item in group.items"
            :key="`${item.kind}-${item.id}`"
            data-switch-item
            type="button"
            class="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-start text-[13px] text-foreground transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
            :class="isCurrent(item) ? 'bg-muted' : ''"
            :aria-current="isCurrent(item) ? 'page' : undefined"
            @click="go(item)"
          >
            <AppIcon :icon="item.icon" :fallback="item.fallback" :size="15" class="shrink-0 text-muted-foreground" />
            <span class="min-w-0 flex-1 truncate" :class="isCurrent(item) ? 'font-semibold text-primary' : ''">{{ item.name }}</span>
            <span v-if="item.count !== null" class="text-[12.5px] text-muted-foreground tabular-nums">{{ formatNumber(item.count) }}</span>
            <Check v-if="isCurrent(item)" :size="14" :stroke-width="2.25" class="shrink-0 text-primary" aria-hidden="true" />
          </button>
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>
