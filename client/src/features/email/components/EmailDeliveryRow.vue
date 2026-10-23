<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookOpen, Ellipsis, RotateCcw, Trash2 } from '@lucide/vue'
import type { EmailSendLogEntry } from '@bookorbit/types'

import BookCoverImage from '@/features/book/components/BookCoverImage.vue'
import BookFormatChip from '@/features/book/components/BookFormatChip.vue'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { formatBytes } from '@/lib/formatting'
import { formatDateTime, formatRelativeFromNow } from '@/i18n/formatters'
import EmailDeliveryReason from './EmailDeliveryReason.vue'
import EmailDeliveryStatus from './EmailDeliveryStatus.vue'
import EmailTile from './EmailTile.vue'
import { deliveryKind, needsAttention } from '../lib/email-delivery'
import { deviceLook } from '../lib/email-devices'

const props = withDefaults(
  defineProps<{
    entry: EmailSendLogEntry
    /** The recipient's device, when it still exists. */
    deviceType?: string | null
    recipientKnown?: boolean
    serverName?: string | null
    serverHost?: string | null
    busy?: boolean
  }>(),
  { deviceType: null, recipientKnown: true, serverName: null, serverHost: null, busy: false },
)

const emit = defineEmits<{ resend: [entry: EmailSendLogEntry]; remove: [entry: EmailSendLogEntry]; openBook: [bookId: number] }>()

const { t } = useI18n()

const kind = computed(() => deliveryKind(props.entry))
const attention = computed(() => needsAttention(props.entry))
const look = computed(() => deviceLook(props.deviceType, props.recipientKnown))
const title = computed(() => props.entry.bookTitle ?? t('email.recent.deletedBook'))
const who = computed(() => props.entry.toName || props.entry.toEmail)
const when = computed(() => formatRelativeFromNow(new Date(props.entry.createdAt)))
const exact = computed(() => formatDateTime(new Date(props.entry.createdAt)))
/** A rule down the start edge marks a row that is not done; a delivered row has none. */
const tone = computed(() => {
  if (kind.value === 'failed') return 'shadow-[inset_2px_0_0_var(--destructive)]'
  if (kind.value === 'unconfirmed' || kind.value === 'retrying') return 'shadow-[inset_2px_0_0_var(--pill-warning)]'
  if (kind.value === 'sending') return 'shadow-[inset_2px_0_0_var(--primary)]'
  return ''
})

function handleResend() {
  emit('resend', props.entry)
}
function handleRemove() {
  emit('remove', props.entry)
}
function handleOpenBook() {
  if (props.entry.bookId !== null) emit('openBook', props.entry.bookId)
}
</script>

<template>
  <div
    class="group/row relative grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2.5 @3xl:grid-cols-(--email-ledger-cols) @3xl:gap-x-3.5 @3xl:gap-y-0.5 transition-colors hover:bg-foreground/[0.025] @3xl:min-h-[60px] @3xl:px-4 @3xl:py-[9px]"
    :class="tone"
  >
    <BookCoverImage
      v-if="entry.bookId !== null"
      :book-id="entry.bookId"
      class="row-span-3 h-[42px] w-7 self-start rounded-[3px] bg-muted object-cover shadow-xs ring-1 ring-foreground/10 @3xl:row-span-1 @3xl:self-center"
    />
    <span v-else class="row-span-3 h-[42px] w-7 self-start rounded-[3px] bg-muted @3xl:row-span-1 @3xl:self-center" />
    <div class="min-w-0">
      <p class="truncate text-sm font-medium text-foreground">{{ title }}</p>
      <p v-if="entry.bookAuthors" class="mt-0.5 truncate text-xs text-muted-foreground">{{ entry.bookAuthors }}</p>
    </div>
    <div class="col-start-2 row-start-2 flex min-w-0 items-center gap-2 @3xl:col-start-auto @3xl:row-start-auto">
      <EmailTile :icon="look.icon" :color="look.color" :size="28" :icon-size="14" />
      <p class="truncate text-[13.5px] text-foreground">{{ who }}</p>
    </div>
    <span class="hidden items-center gap-[7px] text-[12.5px] tabular-nums whitespace-nowrap text-muted-foreground @3xl:inline-flex">
      <BookFormatChip
        v-if="entry.fileFormat"
        :format-key="entry.fileFormat"
        class="rounded-[5px] px-1.5 py-0 text-[11px] leading-[17px] tracking-[0.02em]"
      />
      {{ entry.fileSizeBytes ? formatBytes(entry.fileSizeBytes) : '' }}
    </span>
    <span class="col-start-3 row-start-1 justify-self-end @3xl:col-start-auto @3xl:row-start-auto @3xl:justify-self-start">
      <EmailDeliveryStatus v-if="kind !== 'sent'" :entry="entry" />
    </span>
    <span
      class="col-start-3 row-start-2 justify-self-end text-[12.5px] tabular-nums whitespace-nowrap text-muted-foreground @3xl:col-start-auto @3xl:row-start-auto @3xl:justify-self-start"
      :title="exact"
    >
      {{ when }}
    </span>
    <div class="col-start-3 row-start-3 flex justify-end @3xl:col-start-auto @3xl:row-start-auto">
      <Button v-if="attention" variant="outline" size="sm" class="h-6 gap-[5px] rounded-[6px] px-2 text-xs" :disabled="busy" @click="handleResend">
        <RotateCcw :size="13" aria-hidden="true" />{{ t('email.recent.resend') }}
      </Button>
      <DropdownMenu v-else>
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="size-7 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
            :aria-label="t('email.recent.moreActions', { title })"
          >
            <Ellipsis :size="16" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-48">
          <DropdownMenuItem v-if="entry.bookId !== null" @select="handleOpenBook">
            <BookOpen :size="15" aria-hidden="true" />{{ t('email.recent.openBook') }}
          </DropdownMenuItem>
          <DropdownMenuSeparator v-if="entry.bookId !== null" />
          <DropdownMenuItem variant="destructive" :disabled="busy" @select="handleRemove">
            <Trash2 :size="15" aria-hidden="true" />{{ t('email.recent.delete') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <EmailDeliveryReason
      v-if="kind !== 'sent' && kind !== 'sending'"
      :entry="entry"
      :server-name="serverName"
      :server-host="serverHost"
      class="col-span-2 col-start-2 mt-0.5 @3xl:col-span-5 @3xl:col-start-2"
    />
  </div>
</template>
