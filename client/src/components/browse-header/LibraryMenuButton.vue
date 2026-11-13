<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, LibraryBig } from '@lucide/vue'
import type { AcceptableValue } from 'reka-ui'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { barButton, barButtonOn } from './browse-header'

/** Narrows a page to one library, as a bar button with a menu of libraries. */
const props = defineProps<{
  libraryId: number | null
  libraries: { id: number; name: string }[]
  allLabel: string
}>()

const emit = defineEmits<{
  'update:libraryId': [value: number | null]
}>()

const { t } = useI18n()

const ALL = 'all'
const selected = computed(() => (props.libraryId === null ? ALL : String(props.libraryId)))
const buttonLabel = computed(() => props.libraries.find((library) => library.id === props.libraryId)?.name ?? props.allLabel)

function handleSelect(value: AcceptableValue) {
  if (typeof value !== 'string') return
  emit('update:libraryId', value === ALL ? null : Number(value))
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        :class="cn(barButton, libraryId !== null && barButtonOn)"
        :aria-label="`${t('book.filter.fields.library')}: ${buttonLabel}`"
      >
        <LibraryBig :size="14" :class="libraryId !== null ? 'text-primary' : 'text-muted-foreground'" aria-hidden="true" />
        <span class="max-w-[12rem] truncate">{{ buttonLabel }}</span>
        <ChevronDown :size="13" class="-ms-0.5 text-muted-foreground" aria-hidden="true" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="max-h-80 w-56 overflow-y-auto">
      <DropdownMenuRadioGroup :model-value="selected" @update:model-value="handleSelect">
        <DropdownMenuRadioItem :value="ALL">{{ allLabel }}</DropdownMenuRadioItem>
        <DropdownMenuRadioItem v-for="library in libraries" :key="library.id" :value="String(library.id)">
          <span class="truncate">{{ library.name }}</span>
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
