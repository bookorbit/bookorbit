<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ChevronDown, Library } from '@lucide/vue'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatNumber } from '@/i18n/formatters'
import { cn } from '@/lib/utils'
import { barButton, barButtonOn } from './browse-header'

/** Narrows an all-library list (authors, series) to one library, as a bar dropdown. */
const props = defineProps<{
  libraries: { id: number; name: string; bookCount?: number }[]
  modelValue: number | null
  /** Leave the phone bar to search. */
  hideOnPhone?: boolean
  /** A heading over the choices, saying what picking a library changes. */
  menuLabel?: string
  /** Shows each library's book count beside its name. */
  showCounts?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number | null]
}>()

const { t } = useI18n()

const active = computed(() => props.libraries.find((library) => library.id === props.modelValue) ?? null)
const allCount = computed(() => props.libraries.reduce((sum, library) => sum + (library.bookCount ?? 0), 0))

function selectAll() {
  emit('update:modelValue', null)
}

function selectLibrary(id: number) {
  emit('update:modelValue', id)
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        :class="cn(barButton, hideOnPhone && 'hidden md:inline-flex', active && barButtonOn)"
        :aria-label="t('components.browseHeader.facets.library')"
      >
        <Library :size="14" :class="active ? 'text-primary' : 'text-muted-foreground'" aria-hidden="true" />
        <span class="hidden max-w-[10rem] truncate lg:inline">{{ active ? active.name : t('author.filters.allLibraries') }}</span>
        <ChevronDown :size="13" class="-ms-0.5" :class="active ? 'text-primary' : 'text-muted-foreground'" aria-hidden="true" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="max-h-72 w-56 overflow-y-auto">
      <DropdownMenuLabel v-if="menuLabel" class="pt-[7px] pb-1 text-[10.5px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
        {{ menuLabel }}
      </DropdownMenuLabel>
      <DropdownMenuItem @click="selectAll">
        <Check class="mr-2 h-4 w-4" :class="modelValue === null ? '' : 'opacity-0'" />
        {{ t('author.filters.allLibraries') }}
        <span v-if="showCounts" class="ms-auto text-xs text-muted-foreground tabular-nums">{{ formatNumber(allCount) }}</span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem v-for="library in libraries" :key="library.id" @click="selectLibrary(library.id)">
        <Check class="mr-2 h-4 w-4" :class="modelValue === library.id ? '' : 'opacity-0'" />
        <span class="truncate">{{ library.name }}</span>
        <span v-if="showCounts && library.bookCount !== undefined" class="ms-auto ps-3 text-xs text-muted-foreground tabular-nums">{{
          formatNumber(library.bookCount)
        }}</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
