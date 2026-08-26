<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Ellipsis } from '@lucide/vue'
import { isGrabbableBookRequestStatus } from '@bookorbit/types'
import type { BookRequestItem } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { canCancelRequest, canDeleteRequest, canDismissRequest } from '../requestActions'

/**
 * The actions one request row offers: the one thing to do next, and everything else behind a menu.
 *
 * Extracted because the list renders in two shapes - a table above `lg` and stacked cards below -
 * and both need exactly this cluster. Written out twice it drifted: the same six menu items in the
 * same order, differing only in where the line breaks fell. Layout stays with the caller, which is
 * the only part that genuinely differs between the two.
 */
const props = defineProps<{
  request: BookRequestItem
  canManage: boolean
  /** Whether the viewer may drive fulfilment on rows that are theirs to drive. */
  canSelfFulfil: boolean
  currentUserId: number | null
  busy: boolean
}>()

const emit = defineEmits<{
  open: [request: BookRequestItem]
  approve: [request: BookRequestItem]
  reject: [request: BookRequestItem]
  cancel: [request: BookRequestItem]
  dismiss: [request: BookRequestItem]
  restore: [request: BookRequestItem]
  remove: [request: BookRequestItem]
  grab: [request: BookRequestItem]
}>()

const { t } = useI18n()

const isPending = computed(() => props.request.status === 'pending')
const canApprove = computed(() => props.canManage && isPending.value)
const canGrab = computed(() => props.canManage && isGrabbableBookRequestStatus(props.request.status))
const canCancel = computed(() => canCancelRequest(props.request, props.currentUserId, props.canManage, props.canSelfFulfil))
const canDismiss = computed(() => canDismissRequest(props.request))
const canDelete = computed(() => canDeleteRequest(props.request, props.canManage))

function handleOpen() {
  emit('open', props.request)
}

function handleApprove() {
  emit('approve', props.request)
}

function handleReject() {
  emit('reject', props.request)
}

function handleCancel() {
  emit('cancel', props.request)
}

function handleDismiss() {
  emit('dismiss', props.request)
}

function handleRestore() {
  emit('restore', props.request)
}

function handleRemove() {
  emit('remove', props.request)
}

function handleGrab() {
  emit('grab', props.request)
}
</script>

<template>
  <Button v-if="canApprove" size="sm" :disabled="busy" @click="handleApprove">{{ t('bookRequests.actions.approve') }}</Button>
  <Button v-else-if="canGrab" variant="outline" size="sm" :disabled="busy" @click="handleGrab">{{ t('bookRequests.actions.grab') }}</Button>
  <Button v-else variant="outline" size="sm" @click="handleOpen">{{ t('bookRequests.card.details') }}</Button>

  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="icon-sm" :aria-label="t('bookRequests.card.moreActions', { title: request.title })">
        <Ellipsis :size="15" aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem v-if="canApprove" :disabled="busy" @click="handleReject">{{ t('bookRequests.actions.reject') }}</DropdownMenuItem>
      <DropdownMenuItem v-if="canGrab && !isPending" :disabled="busy" @click="handleGrab">{{ t('bookRequests.actions.grab') }}</DropdownMenuItem>
      <DropdownMenuItem v-if="canDismiss && !request.dismissed" :disabled="busy" @click="handleDismiss">
        {{ t('bookRequests.actions.dismiss') }}
      </DropdownMenuItem>
      <DropdownMenuItem v-if="canDismiss && request.dismissed" :disabled="busy" @click="handleRestore">
        {{ t('bookRequests.actions.restore') }}
      </DropdownMenuItem>
      <DropdownMenuItem v-if="canCancel" variant="destructive" :disabled="busy" @click="handleCancel">
        {{ t('bookRequests.actions.cancel') }}
      </DropdownMenuItem>
      <DropdownMenuItem v-if="canDelete" variant="destructive" :disabled="busy" @click="handleRemove">
        {{ t('bookRequests.actions.delete') }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
