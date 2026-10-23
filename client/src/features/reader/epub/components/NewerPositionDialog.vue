<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { Button } from '@/components/ui/button'
import { formatPercent } from '@/i18n/formatters'

const props = defineProps<{
  open: boolean
  remotePercentage: number
  localPercentage: number
}>()

const emit = defineEmits<{ follow: []; stay: [] }>()

const { t } = useI18n()

// One decimal, because the two places are often within a percent of each other.
const remote = computed(() => formatPercent(props.remotePercentage / 100, 1))
const local = computed(() => formatPercent(props.localPercentage / 100, 1))

// Only the two answers close it: staying saves this page over the other device's, so it is never
// the outcome of a stray Escape or click.
function preventDismiss(event: Event) {
  event.preventDefault()
}

function handleFollow() {
  emit('follow')
}

function handleStay() {
  emit('stay')
}
</script>

<template>
  <DialogRoot :open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[70] bg-scrim" />
      <DialogContent
        aria-modal="true"
        class="fixed left-1/2 top-1/2 z-[70] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @escape-key-down="preventDismiss"
        @pointer-down-outside="preventDismiss"
        @interact-outside="preventDismiss"
      >
        <DialogTitle class="text-lg font-semibold text-foreground">{{ t('reader.newerPositionDialog.title') }}</DialogTitle>
        <DialogDescription class="mt-1 text-sm text-muted-foreground">
          {{ t('reader.newerPositionDialog.description', { remote, local }) }}
        </DialogDescription>
        <div class="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="outline" @click="handleStay">{{ t('reader.newerPositionDialog.stay', { pct: local }) }}</Button>
          <Button @click="handleFollow">{{ t('reader.newerPositionDialog.follow', { pct: remote }) }}</Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
