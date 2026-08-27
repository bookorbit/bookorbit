<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Library } from '@lucide/vue'
import { formatNumber } from '@/i18n/formatters'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { AuthorQuickFilter, AuthorQuickFilterCounts, LibraryFilterOption } from '../types/author'

const props = defineProps<{
  quickFilter: AuthorQuickFilter
  counts?: AuthorQuickFilterCounts | null
  libraries: LibraryFilterOption[]
  libraryId: number | null
}>()

const emit = defineEmits<{
  'update:quickFilter': [value: AuthorQuickFilter]
  'update:libraryId': [value: number | null]
}>()

const { t } = useI18n()

const CHIPS: { key: AuthorQuickFilter; label: string }[] = [
  { key: 'all', label: 'author.filters.chips.all' },
  { key: 'noPortrait', label: 'author.filters.chips.noPortrait' },
  { key: 'multipleBooks', label: 'author.filters.chips.multipleBooks' },
  { key: 'recentlyAdded', label: 'author.filters.chips.recentlyAdded' },
  { key: 'noSortName', label: 'author.filters.chips.noSortName' },
]

const activeLibrary = computed(() => props.libraries.find((library) => library.id === props.libraryId) ?? null)

function countFor(key: AuthorQuickFilter): string | null {
  const counts = props.counts
  if (!counts) return null
  const value = counts[key]
  return typeof value === 'number' ? formatNumber(value) : null
}

function selectChip(key: AuthorQuickFilter) {
  emit('update:quickFilter', key)
}

function selectAllLibraries() {
  emit('update:libraryId', null)
}
</script>

<template>
  <div
    class="-mx-1 flex shrink-0 items-center gap-1.5 overflow-x-auto px-1 py-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    role="group"
    :aria-label="t('author.filters.chips.groupLabel')"
  >
    <button
      v-for="chip in CHIPS"
      :key="chip.key"
      type="button"
      class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors sm:h-[26px] sm:px-2.5 sm:text-[11.5px]"
      :class="
        quickFilter === chip.key
          ? 'border-primary/55 bg-primary/12 text-primary'
          : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
      "
      :aria-pressed="quickFilter === chip.key"
      @click="selectChip(chip.key)"
    >
      {{ t(chip.label) }}
      <span
        v-if="countFor(chip.key)"
        class="text-[11px] font-bold tabular-nums"
        :class="quickFilter === chip.key ? 'text-primary' : 'text-muted-foreground'"
      >
        {{ countFor(chip.key) }}
      </span>
    </button>

    <span v-if="libraries.length > 1" class="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden="true" />

    <DropdownMenu v-if="libraries.length > 1">
      <DropdownMenuTrigger as-child>
        <button
          type="button"
          class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors sm:h-[26px] sm:px-2.5 sm:text-[11.5px]"
          :class="
            activeLibrary
              ? 'border-primary/55 bg-primary/12 text-primary'
              : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
          "
        >
          <Library :size="12" />
          <span class="max-w-[8rem] truncate">{{ activeLibrary ? activeLibrary.name : t('author.filters.allLibraries') }}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="max-h-72 overflow-y-auto">
        <DropdownMenuItem @click="selectAllLibraries">
          <Check class="mr-2 h-4 w-4" :class="libraryId === null ? '' : 'opacity-0'" />
          {{ t('author.filters.allLibraries') }}
        </DropdownMenuItem>
        <DropdownMenuItem v-for="library in libraries" :key="library.id" @click="emit('update:libraryId', library.id)">
          <Check class="mr-2 h-4 w-4" :class="libraryId === library.id ? '' : 'opacity-0'" />
          <span class="truncate">{{ library.name }}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
