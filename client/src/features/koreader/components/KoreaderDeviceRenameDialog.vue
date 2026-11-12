<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2 } from '@lucide/vue'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { KOREADER_DEVICE_NAME_MAX_LENGTH } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { koreaderDeviceLabel } from '@/features/koreader/lib/device-label'

const props = defineProps<{
  /** The device being renamed; the dialog is open while one is set. */
  device: { deviceId: string; model: string; deviceName: string | null } | null
  saving: boolean
}>()

const emit = defineEmits<{ save: [name: string]; cancel: [] }>()

const { t } = useI18n()
const inputId = useId()
const modelHintId = useId()

const draft = ref('')
const unchanged = computed(() => draft.value.trim() === (props.device?.deviceName ?? '').trim())
const modelLabel = computed(() => (props.device ? koreaderDeviceLabel(props.device.model) : ''))

watch(
  () => props.device,
  (device) => {
    draft.value = device?.deviceName ?? ''
  },
  { immediate: true },
)

function handleOpenChange(open: boolean) {
  if (!open && !props.saving) emit('cancel')
}

function handleCancel() {
  if (!props.saving) emit('cancel')
}

function handleSubmit() {
  if (props.saving || unchanged.value) return
  emit('save', draft.value.trim())
}
</script>

<template>
  <DialogRoot :open="device !== null" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[70] bg-scrim" />
      <DialogContent
        aria-modal="true"
        class="fixed left-1/2 top-1/2 z-[70] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <form @submit.prevent="handleSubmit">
          <DialogTitle class="text-lg font-semibold text-foreground">{{ t('settings.reader.koreader.renameDevice.title') }}</DialogTitle>
          <DialogDescription class="mt-1 text-sm text-muted-foreground">
            {{ t('settings.reader.koreader.renameDevice.description') }}
          </DialogDescription>
          <label :for="inputId" class="mt-4 block text-xs font-medium text-foreground">
            {{ t('settings.reader.koreader.renameDevice.nameLabel') }}
          </label>
          <Input
            :id="inputId"
            v-model="draft"
            class="mt-1.5"
            type="text"
            autocomplete="off"
            :maxlength="KOREADER_DEVICE_NAME_MAX_LENGTH"
            :placeholder="modelLabel"
            :aria-describedby="modelHintId"
            :disabled="saving"
          />
          <p :id="modelHintId" class="mt-1.5 break-all text-xs text-muted-foreground">
            {{ t('settings.reader.koreader.renameDevice.modelHint', { model: device?.model ?? '' }) }}
          </p>
          <div class="mt-6 flex justify-end gap-2">
            <Button type="button" variant="outline" :disabled="saving" @click="handleCancel">{{ t('common.cancel') }}</Button>
            <Button type="submit" :disabled="saving || unchanged">
              <Loader2 v-if="saving" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
              {{ t('common.save') }}
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
