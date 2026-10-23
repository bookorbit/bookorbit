<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, CircleAlert, LoaderCircle, RotateCcw, X } from '@lucide/vue'
import type { EmailSendLogEntry } from '@bookorbit/types'

import { MAX_SEND_ATTEMPTS, deliveryKind, type DeliveryKind } from '../lib/email-delivery'

const props = defineProps<{ entry: Pick<EmailSendLogEntry, 'status' | 'attemptCount' | 'failureCode' | 'errorMessage'> }>()

const { t } = useI18n()

const TONES: Record<DeliveryKind, string> = {
  sent: 'border-success/30 bg-success/12 text-success',
  sending: 'border-primary/35 bg-primary/13 text-primary',
  retrying: 'border-[var(--pill-warning)]/32 bg-[var(--pill-warning)]/12 text-[var(--pill-warning)]',
  unconfirmed: 'border-[var(--pill-warning)]/32 bg-[var(--pill-warning)]/12 text-[var(--pill-warning)]',
  failed: 'border-destructive/32 bg-destructive/12 text-destructive',
}

const kind = computed(() => deliveryKind(props.entry))
const label = computed(() =>
  kind.value === 'retrying'
    ? t('email.status.retrying', { attempt: Math.min(props.entry.attemptCount + 1, MAX_SEND_ATTEMPTS), total: MAX_SEND_ATTEMPTS })
    : t(`email.status.${kind.value}`),
)
</script>

<template>
  <span class="inline-flex h-[22px] items-center gap-[5px] whitespace-nowrap rounded-full border px-2 text-[11.5px] font-[550]" :class="TONES[kind]">
    <Check v-if="kind === 'sent'" :size="12" :stroke-width="2.5" aria-hidden="true" />
    <LoaderCircle v-else-if="kind === 'sending'" :size="12" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
    <RotateCcw v-else-if="kind === 'retrying'" :size="12" aria-hidden="true" />
    <CircleAlert v-else-if="kind === 'unconfirmed'" :size="12" aria-hidden="true" />
    <X v-else :size="12" :stroke-width="2.5" aria-hidden="true" />
    {{ label }}
  </span>
</template>
