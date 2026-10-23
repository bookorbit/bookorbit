<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Ellipsis } from '@lucide/vue'
import type { BookRequestItem } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { orderedHalves, pairActionKey, pairRowActions } from '../requestPair'

/**
 * The actions a pair row offers. Every one of them says which half it touches, "both" or the one
 * medium, because a row holding two requests can no longer let a bare "Approve" stand for either.
 * Anything that only makes sense for one half at a time - deleting, a release decision, the decision
 * note - lives in the drawer, which the menu opens on either half.
 */
const props = defineProps<{
  row: BookRequestItem
  canManage: boolean
  canSelfFulfil: boolean
  currentUserId: number | null
  busy: boolean
}>()

const emit = defineEmits<{
  open: [request: BookRequestItem]
  grab: [request: BookRequestItem]
  approve: [requests: BookRequestItem[]]
  reject: [requests: BookRequestItem[]]
  cancel: [requests: BookRequestItem[]]
  dismiss: [requests: BookRequestItem[]]
  restore: [requests: BookRequestItem[]]
}>()

const { t } = useI18n()

const halves = computed(() => orderedHalves(props.row))
const actions = computed(() =>
  pairRowActions(props.row, { userId: props.currentUserId, canManage: props.canManage, canSelfFulfil: props.canSelfFulfil }),
)
/** Both halves waiting is one job in the picker, which opens on the e-book and tabs to the other. */
const grabLabel = computed(() => {
  if (actions.value.grabHalves.length > 1) return t('bookRequests.actions.pair.chooseReleases')
  return actions.value.grab?.mediaKind === 'audiobook' ? t('bookRequests.actions.pair.grabAudiobook') : t('bookRequests.actions.pair.grabEbook')
})

function openLabel(half: BookRequestItem): string {
  return half.mediaKind === 'audiobook' ? t('bookRequests.actions.pair.openAudiobook') : t('bookRequests.actions.pair.openEbook')
}

function handleOpenLead() {
  emit('open', props.row)
}

function handleOpen(half: BookRequestItem) {
  emit('open', half)
}

function handleGrab() {
  if (actions.value.grab) emit('grab', actions.value.grab)
}

function handleApprove() {
  emit('approve', actions.value.approve)
}

function handleReject() {
  emit('reject', actions.value.reject)
}

function handleCancel() {
  emit('cancel', actions.value.cancel)
}

function handleDismiss() {
  emit('dismiss', actions.value.dismiss)
}

function handleRestore() {
  emit('restore', actions.value.restore)
}
</script>

<template>
  <Button v-if="actions.approve.length" size="sm" :disabled="busy" @click="handleApprove">
    {{ t(pairActionKey('approve', actions.approve)) }}
  </Button>
  <Button v-else-if="actions.grab && canManage" variant="outline" size="sm" :disabled="busy" @click="handleGrab">{{ grabLabel }}</Button>
  <Button v-else variant="outline" size="sm" @click="handleOpenLead">{{ t('bookRequests.card.details') }}</Button>

  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="icon-sm" :aria-label="t('bookRequests.card.moreActions', { title: row.title })">
        <Ellipsis :size="15" aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem v-for="half in halves" :key="half.id" @click="handleOpen(half)">{{ openLabel(half) }}</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem v-if="actions.reject.length" :disabled="busy" @click="handleReject">
        {{ t(pairActionKey('reject', actions.reject)) }}
      </DropdownMenuItem>
      <DropdownMenuItem v-if="actions.grab && canManage && actions.approve.length" :disabled="busy" @click="handleGrab">
        {{ grabLabel }}
      </DropdownMenuItem>
      <DropdownMenuItem v-if="actions.dismiss.length" :disabled="busy" @click="handleDismiss">
        {{ t(pairActionKey('dismiss', actions.dismiss)) }}
      </DropdownMenuItem>
      <DropdownMenuItem v-if="actions.restore.length" :disabled="busy" @click="handleRestore">
        {{ t(pairActionKey('restore', actions.restore)) }}
      </DropdownMenuItem>
      <DropdownMenuItem v-if="actions.cancel.length" variant="destructive" :disabled="busy" @click="handleCancel">
        {{ t(pairActionKey('cancel', actions.cancel)) }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
