<script setup lang="ts" generic="T extends string">
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import FieldListbox from './FieldListbox.vue'
import type { FieldOptionGroup } from './field-listbox'

/** A field list in a small popover under its trigger: the builder's Add filter and field buttons, and the scope editor's sort field. */
withDefaults(
  defineProps<{
    open: boolean
    groups: FieldOptionGroup<T>[]
    selected?: T | null
    exclude?: readonly T[]
    title: string
    placeholder: string
    searchLabel: string
    listLabel: string
    align?: 'start' | 'center' | 'end'
    side?: 'top' | 'bottom'
  }>(),
  { selected: null, exclude: () => [], align: 'start', side: 'bottom' },
)

const emit = defineEmits<{
  'update:open': [value: boolean]
  pick: [value: T]
}>()

defineSlots<{ trigger: () => unknown }>()

function handleOpen(value: boolean) {
  emit('update:open', value)
}

function handlePick(value: T) {
  emit('pick', value)
  emit('update:open', false)
}

function handleCloseAutoFocus(event: Event) {
  // A pick usually opens the new rule's value panel next; returning focus here would pull it back out.
  event.preventDefault()
}
</script>

<template>
  <Popover :open="open" @update:open="handleOpen">
    <PopoverTrigger as-child>
      <slot name="trigger" />
    </PopoverTrigger>
    <PopoverContent
      :align="align"
      :side="side"
      :side-offset="4"
      :collision-padding="8"
      :aria-label="title"
      class="flex max-h-(--reka-popover-content-available-height) w-[280px] max-w-[calc(100vw-16px)] flex-col overflow-hidden p-0"
      @close-auto-focus="handleCloseAutoFocus"
    >
      <FieldListbox
        :groups="groups"
        :selected="selected"
        :exclude="exclude"
        searchable
        :placeholder="placeholder"
        :search-label="searchLabel"
        :list-label="listLabel"
        list-class="max-h-[340px]"
        @pick="handlePick"
      />
    </PopoverContent>
  </Popover>
</template>
