<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Copy, TriangleAlert } from '@lucide/vue'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { Button } from '@/components/ui/button'
import { copyToClipboard } from '@/lib/clipboard'

/**
 * Shows a new key's token the one time it exists outside the server. The token lives only in the
 * parent's state for as long as this dialog is open; closing it hands control back so the parent
 * drops the token.
 */
const props = defineProps<{ token: string | null; keyName: string }>()

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const fieldId = `api-key-token-${useId()}`

const copied = ref(false)
const copyFailed = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

const open = computed(() => props.token !== null)

const examples = computed(() => {
  const origin = window.location.origin
  return [
    `curl -H "Authorization: Bearer $BOOKORBIT_API_KEY" ${origin}/api/v1/auth/me`,
    `curl -H "X-Api-Key: $BOOKORBIT_API_KEY" ${origin}/api/v1/auth/me`,
  ]
})

watch(open, () => {
  copied.value = false
  copyFailed.value = false
})

onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
})

async function handleCopy() {
  if (!props.token) return
  const ok = await copyToClipboard(props.token)
  copyFailed.value = !ok
  copied.value = ok
  if (copiedTimer) clearTimeout(copiedTimer)
  if (ok) {
    copiedTimer = setTimeout(() => {
      copied.value = false
      copiedTimer = null
    }, 2500)
  }
}

function selectToken(event: FocusEvent) {
  ;(event.target as HTMLInputElement).select()
}

function handleOpenChange(value: boolean) {
  if (!value) emit('close')
}

/** A stray click outside must not throw away a token that can never be shown again. */
function keepOpen(event: Event) {
  event.preventDefault()
}

function handleDone() {
  emit('close')
}
</script>

<template>
  <DialogRoot :open="open" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[60] bg-scrim" />
      <DialogContent
        aria-modal="true"
        class="fixed left-1/2 top-1/2 z-[60] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-card p-5 shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @pointer-down-outside="keepOpen"
      >
        <DialogTitle class="text-lg font-semibold text-foreground">{{ t('apiKeys.reveal.title', { name: keyName }) }}</DialogTitle>
        <DialogDescription class="mt-1 text-sm text-muted-foreground">{{ t('apiKeys.reveal.description') }}</DialogDescription>

        <p
          class="mt-4 flex items-start gap-2 rounded-lg border border-[var(--pill-warning)]/40 bg-[var(--pill-warning)]/10 px-3 py-2 text-sm text-[var(--pill-warning)]"
        >
          <TriangleAlert :size="16" class="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{{ t('apiKeys.reveal.onceOnly') }}</span>
        </p>

        <label :for="fieldId" class="settings-label mt-4 block">{{ t('apiKeys.reveal.tokenLabel') }}</label>
        <div class="mt-1.5 flex gap-2">
          <input
            :id="fieldId"
            :value="token ?? ''"
            type="text"
            readonly
            spellcheck="false"
            autocomplete="off"
            class="input-field min-w-0 flex-1 font-mono text-xs"
            data-testid="api-key-token"
            @focus="selectToken"
          />
          <Button type="button" variant="outline" class="shrink-0" @click="handleCopy">
            <Check v-if="copied" :size="14" aria-hidden="true" />
            <Copy v-else :size="14" aria-hidden="true" />
            {{ copied ? t('apiKeys.reveal.copied') : t('apiKeys.reveal.copy') }}
          </Button>
        </div>
        <p role="status" aria-live="polite" class="mt-1 min-h-4 text-xs" :class="copyFailed ? 'text-destructive' : 'text-muted-foreground'">
          {{ copyFailed ? t('apiKeys.reveal.copyFailed') : copied ? t('apiKeys.reveal.copiedAnnouncement') : '' }}
        </p>

        <div class="mt-3 space-y-2">
          <p class="settings-label">{{ t('apiKeys.reveal.examplesTitle') }}</p>
          <p class="settings-hint">{{ t('apiKeys.reveal.examplesHint') }}</p>
          <pre
            v-for="example in examples"
            :key="example"
            dir="ltr"
            class="overflow-x-auto rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs text-foreground"
            >{{ example }}</pre>
        </div>

        <div class="mt-5 flex justify-end">
          <Button type="button" @click="handleDone">{{ t('apiKeys.reveal.done') }}</Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
