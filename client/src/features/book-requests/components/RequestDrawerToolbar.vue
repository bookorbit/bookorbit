<script setup lang="ts">
import { inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronLeft, ChevronUp, X } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { REQUEST_DRAWER } from '../requestDrawerContext'

const props = withDefaults(
  defineProps<{
    /** `back` pops to the request behind the picker; `close` leaves the drawer entirely. */
    leading?: 'close' | 'back'
    /** Only the request itself walks the queue. Inside the picker there is one release list. */
    stepper?: boolean
  }>(),
  { leading: 'close', stepper: false },
)

const emit = defineEmits<{ back: [] }>()

const { t } = useI18n()
const drawer = inject(REQUEST_DRAWER, null)

function handleLeading() {
  if (props.leading === 'back') emit('back')
  else drawer?.close()
}

function handleClose() {
  drawer?.close()
}

function handlePrevious() {
  drawer?.goPrevious()
}

function handleNext() {
  drawer?.goNext()
}
</script>

<template>
  <div class="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-2.5">
    <Button
      variant="ghost"
      size="icon-sm"
      :aria-label="leading === 'back' ? t('bookRequests.releases.backToRequest') : t('common.close')"
      @click="handleLeading"
    >
      <component :is="leading === 'back' ? ChevronLeft : X" :size="16" aria-hidden="true" />
    </Button>

    <!--
      Hidden when the open request is not in the list, which a filter change or a dismissal can do
      while the drawer is still open on it. A position of "0 of 12" is worse than no position.
    -->
    <div v-if="stepper && drawer && drawer.position.value > 0" class="flex items-center gap-0.5 rounded-lg border border-border p-0.5">
      <Button
        variant="ghost"
        size="icon-sm"
        class="size-6"
        :disabled="!drawer.hasPrevious.value"
        :aria-label="t('bookRequests.drawer.previous')"
        @click="handlePrevious"
      >
        <ChevronUp :size="14" aria-hidden="true" />
      </Button>
      <span class="px-1 text-xs text-muted-foreground tabular-nums">
        {{ t('bookRequests.drawer.position', { position: drawer.position.value, total: drawer.total.value }) }}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        class="size-6"
        :disabled="!drawer.hasNext.value"
        :aria-label="t('bookRequests.drawer.next')"
        @click="handleNext"
      >
        <ChevronDown :size="14" aria-hidden="true" />
      </Button>
    </div>

    <div class="min-w-0 flex-1"><slot name="title" /></div>

    <div class="flex shrink-0 items-center gap-1"><slot name="actions" /></div>

    <Button v-if="leading === 'back'" variant="ghost" size="icon-sm" :aria-label="t('common.close')" @click="handleClose">
      <X :size="16" aria-hidden="true" />
    </Button>
  </div>
</template>
