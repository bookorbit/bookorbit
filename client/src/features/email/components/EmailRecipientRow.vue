<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Headphones, Pencil } from '@lucide/vue'
import type { EmailRecipient } from '@bookorbit/types'

import BookCoverImage from '@/features/book/components/BookCoverImage.vue'
import BookFormatChip from '@/features/book/components/BookFormatChip.vue'
import { formatDateTime, formatRelativeFromNow } from '@/i18n/formatters'
import EmailStarButton from './EmailStarButton.vue'
import EmailTile from './EmailTile.vue'
import { deliveryKind } from '../lib/email-delivery'
import { deviceLook } from '../lib/email-devices'

const props = defineProps<{ recipient: EmailRecipient; isDefault: boolean; busy?: boolean }>()
const emit = defineEmits<{ edit: [recipient: EmailRecipient]; makeDefault: [recipient: EmailRecipient] }>()

const { t } = useI18n()

const look = computed(() => deviceLook(props.recipient.deviceType))
const narration = computed(() => props.recipient.readAloudDelivery === 'original' && props.recipient.deviceType !== 'kindle')
const metaParts = computed(() => {
  const parts: Array<'device' | 'format' | 'narration'> = []
  if (props.recipient.deviceType) parts.push('device')
  if (props.recipient.preferredFormat) parts.push('format')
  if (narration.value) parts.push('narration')
  return parts
})
const last = computed(() => props.recipient.lastSend ?? null)
/** Only a send that is not done says so; a delivered one just says when. */
const lastWord = computed<{ text: string; tone: string } | null>(() => {
  const entry = last.value
  if (!entry) return null
  const kind = deliveryKind({
    status: entry.status,
    attemptCount: entry.attemptCount ?? 0,
    failureCode: entry.failureCode ?? null,
    errorMessage: entry.errorMessage ?? null,
  })
  if (kind === 'failed') return { text: t('email.card.failed'), tone: 'text-destructive' }
  if (kind === 'unconfirmed') return { text: t('email.card.unconfirmed'), tone: 'text-[var(--pill-warning)]' }
  if (kind === 'retrying') return { text: t('email.card.retrying'), tone: 'text-[var(--pill-warning)]' }
  if (kind === 'sending') return { text: t('email.card.sending'), tone: '' }
  return { text: formatRelativeFromNow(new Date(entry.createdAt)), tone: '' }
})
const lastExact = computed(() => (last.value ? formatDateTime(new Date(last.value.createdAt)) : undefined))

function handleEdit() {
  emit('edit', props.recipient)
}
function handleStar() {
  emit('makeDefault', props.recipient)
}
</script>

<template>
  <!-- The edit button covers the row; the star sits above it so the two never nest. -->
  <div class="group/row relative flex min-h-16 items-center gap-x-3.5 px-3.5 py-3 transition-colors hover:bg-foreground/[0.025] sm:px-4">
    <button
      type="button"
      class="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      :aria-label="t('email.page.editRecipient', { name: recipient.name })"
      @click="handleEdit"
    />
    <EmailTile :icon="look.icon" :color="look.color" :size="36" class="pointer-events-none" />
    <div class="pointer-events-none min-w-0 flex-1">
      <p class="truncate text-sm leading-[1.45] font-medium text-foreground">{{ recipient.name }}</p>
      <p
        class="mt-[3px] flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs leading-[1.45] text-muted-foreground sm:flex-nowrap sm:overflow-hidden sm:whitespace-nowrap"
      >
        <span class="basis-full truncate font-mono text-path-dim sm:basis-auto" dir="ltr">{{ recipient.email }}</span>
        <!-- Each part carries the dot before it, so a wrapped line never ends on a separator. On a phone the
             address takes its own line, so the first dot goes. -->
        <span v-for="(part, index) in metaParts" :key="part" class="inline-flex items-center gap-x-1.5">
          <span :class="index === 0 ? 'hidden sm:inline' : ''" aria-hidden="true">·</span>
          <span v-if="part === 'device'">{{ t(`email.device.${look.labelKey}`) }}</span>
          <BookFormatChip
            v-else-if="part === 'format'"
            :format-key="recipient.preferredFormat ?? ''"
            class="rounded-[5px] px-1.5 py-0 text-[11px] leading-[17px] tracking-[0.02em]"
          />
          <span v-else class="inline-flex items-center gap-1" :title="t('email.card.narrationTitle')">
            <Headphones :size="12" aria-hidden="true" />{{ t('email.card.narration') }}
          </span>
        </span>
      </p>
    </div>
    <p class="pointer-events-none ms-4 hidden min-w-0 items-center gap-[7px] text-xs whitespace-nowrap text-muted-foreground sm:flex">
      <template v-if="last && lastWord">
        <BookCoverImage
          v-if="last.bookId !== null"
          :book-id="last.bookId"
          class="h-6 w-4 shrink-0 rounded-[2px] bg-muted object-cover shadow-xs ring-1 ring-foreground/10"
        />
        <span class="max-w-[180px] truncate font-medium text-foreground">{{ last.bookTitle ?? t('email.recent.deletedBook') }}</span>
        <span :class="lastWord.tone" :title="lastExact">{{ lastWord.text }}</span>
      </template>
      <template v-else>{{ t('email.card.nothingSent') }}</template>
    </p>
    <div class="flex shrink-0 items-center gap-1 sm:ms-4">
      <EmailStarButton
        :on="isDefault"
        :busy="busy"
        :label="isDefault ? t('email.page.defaultRecipient') : t('email.page.makeDefaultRecipient', { name: recipient.name })"
        @star="handleStar"
      />
      <span
        class="pointer-events-none inline-flex size-7 items-center justify-center text-muted-foreground transition-opacity sm:opacity-0 sm:group-hover/row:opacity-100 sm:group-focus-within/row:opacity-100 [@media(hover:none)]:opacity-100"
        aria-hidden="true"
      >
        <Pencil :size="14" />
      </span>
    </div>
  </div>
</template>
