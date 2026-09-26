<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { AlertTriangle, Loader2 } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { Button } from '@/components/ui/button'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    description: string
    confirmLabel: string
    busy?: boolean
    destructive?: boolean
    confirmDisabled?: boolean
    confirmationPhrase?: string
  }>(),
  { busy: false, destructive: true, confirmDisabled: false },
)

const emit = defineEmits<{ confirm: []; cancel: [] }>()

const { t } = useI18n()

const typedPhrase = ref('')
const phraseMatched = computed(() => !props.confirmationPhrase || typedPhrase.value.trim() === props.confirmationPhrase)

watch(
  () => props.open,
  () => {
    typedPhrase.value = ''
  },
)

function handleOpenChange(open: boolean) {
  if (!open && !props.busy) emit('cancel')
}

function handleConfirm() {
  if (!phraseMatched.value) return
  emit('confirm')
}

function handleCancel() {
  if (!props.busy) emit('cancel')
}
</script>

<template>
  <DialogRoot :open="open" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[70] bg-foreground/50" />
      <DialogContent
        aria-modal="true"
        class="fixed left-1/2 top-1/2 z-[70] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div class="flex items-start gap-3">
          <div v-if="destructive" class="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle class="size-5 text-destructive" aria-hidden="true" />
          </div>
          <div class="min-w-0">
            <DialogTitle class="text-lg font-semibold text-foreground">{{ title }}</DialogTitle>
            <DialogDescription class="mt-1 text-sm text-muted-foreground">{{ description }}</DialogDescription>
            <slot />
            <label v-if="confirmationPhrase" class="mt-4 block text-xs font-medium text-foreground">
              {{ t('components.confirmDialog.typeToConfirm', { phrase: confirmationPhrase }) }}
              <input
                v-model="typedPhrase"
                type="text"
                autocomplete="off"
                class="mt-1.5 h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
          </div>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <Button variant="outline" :disabled="busy" @click="handleCancel">{{ t('common.cancel') }}</Button>
          <Button :variant="destructive ? 'destructive' : 'default'" :disabled="busy || confirmDisabled || !phraseMatched" @click="handleConfirm">
            <Loader2 v-if="busy" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {{ confirmLabel }}
          </Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
