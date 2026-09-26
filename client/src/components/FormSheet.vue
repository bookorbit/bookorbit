<script setup lang="ts">
import { ref, watch, type HTMLAttributes } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'

/**
 * The shell every editing sheet shares: header, footer with one disable policy, and the guard that
 * stops a backdrop click from throwing away unsaved edits.
 *
 * `busy` means a write is in flight, so it disables both footer buttons; anything that only makes
 * the form unsubmittable (still loading, invalid, nothing selected) belongs in `submitDisabled`.
 */
const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    description?: string
    side?: 'top' | 'right' | 'bottom' | 'left'
    contentClass?: HTMLAttributes['class']
    /** Re-fires `opened` while the sheet stays open, for sheets that switch which record they edit. */
    resetKey?: string | number | null
    busy?: boolean
    /** Enables the discard confirmation on backdrop, escape, close button and cancel. */
    dirty?: boolean
    error?: string | null
    submitLabel?: string
    submitTestId?: string
    submitDisabled?: boolean
    cancelLabel?: string
    hideFooter?: boolean
  }>(),
  {
    description: undefined,
    side: 'right',
    contentClass: undefined,
    resetKey: undefined,
    busy: false,
    dirty: false,
    error: null,
    submitLabel: undefined,
    submitTestId: undefined,
    submitDisabled: false,
    cancelLabel: undefined,
    hideFooter: false,
  },
)

const emit = defineEmits<{
  'update:open': [open: boolean]
  opened: []
  closed: []
  submit: []
}>()

// Attributes land on the sheet panel rather than the fragment root, so callers keep control of the
// panel's test id and ARIA without the shell having to re-declare a prop for each one.
defineOptions({ inheritAttrs: false })

const { t } = useI18n()
const discardOpen = ref(false)

watch(
  () => [props.open, props.resetKey] as const,
  ([open]) => {
    if (!open) {
      discardOpen.value = false
      emit('closed')
      return
    }
    emit('opened')
  },
  { immediate: true },
)

function handleOpenChange(open: boolean) {
  if (open) {
    emit('update:open', true)
    return
  }
  requestClose()
}

function requestClose() {
  if (props.busy) return
  if (props.dirty) {
    discardOpen.value = true
    return
  }
  emit('update:open', false)
}

function confirmDiscard() {
  discardOpen.value = false
  emit('update:open', false)
}

function cancelDiscard() {
  discardOpen.value = false
}

function handleSubmit() {
  emit('submit')
}
</script>

<template>
  <Sheet :open="open" @update:open="handleOpenChange">
    <SheetContent :side="side" class="w-full gap-0" :class="contentClass" :aria-busy="busy" v-bind="$attrs">
      <SheetHeader>
        <SheetTitle>{{ title }}</SheetTitle>
        <SheetDescription v-if="description">{{ description }}</SheetDescription>
      </SheetHeader>

      <slot />

      <SheetFooter v-if="!hideFooter" class="flex-row items-center justify-end gap-2 border-t border-border">
        <slot name="footer-start" />
        <p v-if="error" class="me-auto min-w-0 text-sm text-destructive" role="alert">{{ error }}</p>
        <Button variant="outline" :disabled="busy" @click="requestClose">{{ cancelLabel ?? t('common.cancel') }}</Button>
        <Button :disabled="busy || submitDisabled" :aria-busy="busy" :data-testid="submitTestId" @click="handleSubmit">
          {{ submitLabel ?? t('common.save') }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>

  <!-- Mounted only while it is asked for: every form sheet in a view would otherwise contribute an
       idle modal to the tree. -->
  <ConfirmDialog
    v-if="discardOpen"
    :open="discardOpen"
    :title="t('components.formSheet.discardTitle')"
    :description="t('components.formSheet.discardDescription')"
    :confirm-label="t('components.formSheet.discardConfirm')"
    @confirm="confirmDiscard"
    @cancel="cancelDiscard"
  />
</template>
