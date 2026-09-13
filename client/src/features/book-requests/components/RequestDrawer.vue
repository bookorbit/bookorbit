<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMediaQuery } from '@vueuse/core'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'

const props = defineProps<{
  open: boolean
  /** 1 is the request itself, 2 is the release picker stacked over it. */
  level: 1 | 2
}>()

const emit = defineEmits<{
  close: []
  back: []
}>()

const { t } = useI18n()

/** Tailwind's `sm`, which is also where the list stops being a table and starts being cards. */
const isNarrowViewport = useMediaQuery('(max-width: 639px)')

const side = computed(() => (isNarrowViewport.value ? ('bottom' as const) : ('right' as const)))

/**
 * The picker needs the extra width to land in the layout it already has below its own widest
 * breakpoint: the facet rail wraps into a bar and the table keeps its optional columns. On a phone
 * it takes the whole screen instead, because a picker row does not survive being half a sheet.
 */
const sizeClass = computed(() => {
  if (isNarrowViewport.value) return props.level === 2 ? 'h-full rounded-none' : 'h-[88svh] rounded-t-xl'
  return props.level === 2 ? 'w-full sm:max-w-[52.5rem]' : 'w-full sm:max-w-[37.5rem]'
})

const title = computed(() => (props.level === 2 ? t('bookRequests.releases.title') : t('bookRequests.drawer.label')))

function handleOpenChange(value: boolean) {
  if (!value) emit('close')
}

/**
 * Escape pops one level rather than dismissing the stack, so leaving the picker lands back on the
 * request it was opened for. Clicking the scrim still closes the lot, which is what a scrim means.
 */
function handleEscape(event: KeyboardEvent) {
  if (props.level !== 2) return
  event.preventDefault()
  emit('back')
}
</script>

<template>
  <Sheet :open="open" @update:open="handleOpenChange">
    <SheetContent
      :side="side"
      hide-close
      class="gap-0 p-0 duration-200 motion-safe:transition-[max-width] motion-reduce:transition-none"
      :class="sizeClass"
      @escape-key-down="handleEscape"
    >
      <SheetTitle class="sr-only">{{ title }}</SheetTitle>
      <SheetDescription class="sr-only">{{ t('bookRequests.drawer.description') }}</SheetDescription>
      <slot />
    </SheetContent>
  </Sheet>
</template>
