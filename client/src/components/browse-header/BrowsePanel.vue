<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { breakpointsTailwind, useBreakpoints } from '@vueuse/core'
import { X } from '@lucide/vue'
import type { PopoverAnchorProps } from 'reka-ui'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

/**
 * A bar control's panel: a popover under its button on a wide screen and, when `phoneSheet` is
 * set, a bottom sheet with the same content on a phone. `anchor` moves the popover onto another
 * element, such as a filter token in the search field, without changing which button toggles it.
 */
const props = withDefaults(
  defineProps<{
    open?: boolean
    title: string
    phoneSheet?: boolean
    align?: 'start' | 'center' | 'end'
    sideOffset?: number
    anchor?: PopoverAnchorProps['reference'] | null
    contentClass?: string
  }>(),
  { open: undefined, phoneSheet: false, align: 'start', sideOffset: 6, anchor: null, contentClass: '' },
)

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

defineSlots<{
  trigger: () => unknown
  default: () => unknown
}>()

const { t } = useI18n()
const isPhone = useBreakpoints(breakpointsTailwind).smaller('sm')
const asSheet = computed(() => props.phoneSheet && isPhone.value)

const localOpen = ref(false)
const openModel = computed({
  get: () => props.open ?? localOpen.value,
  set: (value: boolean) => {
    localOpen.value = value
    emit('update:open', value)
  },
})

let interactedOutside = false
watch(openModel, (open) => {
  if (open) interactedOutside = false
})

function handleInteractOutside() {
  interactedOutside = true
}

/** A panel opened from another element, such as a filter token, hands focus back to it rather than to the bar button. */
function handleCloseAutoFocus(event: Event) {
  const origin = props.anchor && 'contextElement' in props.anchor ? props.anchor.contextElement : null
  if (interactedOutside || !(origin instanceof HTMLElement) || !origin.isConnected) return
  const target = origin.matches('button') ? origin : origin.querySelector<HTMLElement>('button')
  if (!target) return
  event.preventDefault()
  target.focus()
}
</script>

<template>
  <Sheet v-if="asSheet" v-model:open="openModel">
    <SheetTrigger as-child>
      <slot name="trigger" />
    </SheetTrigger>
    <SheetContent
      side="bottom"
      hide-close
      :aria-describedby="undefined"
      class="max-h-[86dvh] gap-0 rounded-t-[18px] bg-popover pb-[max(14px,env(safe-area-inset-bottom))] text-popover-foreground"
    >
      <div class="mx-auto mt-2 mb-0.5 h-1 w-[38px] shrink-0 rounded-full bg-border" aria-hidden="true" />
      <div class="flex shrink-0 items-center gap-2 px-4 pt-1.5 pb-1">
        <SheetTitle class="flex-1 text-base font-semibold text-foreground">{{ title }}</SheetTitle>
        <SheetClose
          class="inline-grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          :aria-label="t('common.close')"
        >
          <X :size="18" aria-hidden="true" />
        </SheetClose>
      </div>
      <div class="flex min-h-0 flex-1 flex-col">
        <slot />
      </div>
    </SheetContent>
  </Sheet>
  <Popover v-else v-model:open="openModel">
    <PopoverAnchor as-child :reference="anchor ?? undefined">
      <PopoverTrigger as-child>
        <slot name="trigger" />
      </PopoverTrigger>
    </PopoverAnchor>
    <PopoverContent
      :align="align"
      :side-offset="sideOffset"
      :collision-padding="8"
      :aria-label="title"
      :class="cn('flex max-h-(--reka-popover-content-available-height) w-auto max-w-[calc(100vw-16px)] flex-col overflow-hidden p-0', contentClass)"
      @interact-outside="handleInteractOutside"
      @close-auto-focus="handleCloseAutoFocus"
    >
      <slot />
    </PopoverContent>
  </Popover>
</template>
