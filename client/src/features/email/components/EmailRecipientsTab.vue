<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Copy, Info, Pencil, Plus, Tablet, TriangleAlert, UsersRound } from '@lucide/vue'
import type { EmailRecipient } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import UserAvatar from '@/components/UserAvatar.vue'
import { copyToClipboard } from '@/lib/clipboard'
import { formatNumber } from '@/i18n/formatters'
import EmailRecipientRow from './EmailRecipientRow.vue'
import EmailTile from './EmailTile.vue'
import type { EmailGroup } from '../composables/useEmailGroups'

const props = defineProps<{
  recipients: EmailRecipient[]
  groups: EmailGroup[]
  defaultRecipientId: number | null
  /** The address Kindle owners must approve: the default server's sender. */
  senderAddress: string | null
  hasServer: boolean
  canManageServers: boolean
  busy?: boolean
}>()

const emit = defineEmits<{
  add: []
  edit: [recipient: EmailRecipient]
  makeDefault: [recipient: EmailRecipient]
  addGroup: []
  editGroup: [group: EmailGroup]
  goToServers: []
}>()

const { t } = useI18n()

const hasKindle = computed(() => props.recipients.some((r) => r.deviceType === 'kindle'))

async function copySender() {
  if (props.senderAddress && (await copyToClipboard(props.senderAddress))) toast.success(t('email.page.addressCopied'))
}
function memberNames(group: EmailGroup): string {
  return group.members.map((member) => member.name).join(', ')
}
function handleAdd() {
  emit('add')
}
function handleEdit(recipient: EmailRecipient) {
  emit('edit', recipient)
}
function handleMakeDefault(recipient: EmailRecipient) {
  emit('makeDefault', recipient)
}
function handleAddGroup() {
  emit('addGroup')
}
function handleEditGroup(group: EmailGroup) {
  emit('editGroup', group)
}
function handleGoToServers() {
  emit('goToServers')
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <section>
      <div
        v-if="!hasServer"
        class="mb-4 grid grid-cols-[18px_minmax(0,1fr)] items-start gap-x-3 gap-y-1 rounded-lg border border-[var(--pill-warning)]/32 bg-[var(--pill-warning)]/6 px-4 py-3.5 sm:grid-cols-[18px_minmax(0,1fr)_auto]"
      >
        <TriangleAlert :size="16" class="mt-0.5 text-[var(--pill-warning)]" aria-hidden="true" />
        <p class="text-sm font-semibold text-foreground">{{ t('email.page.needServerTitle') }}</p>
        <p class="col-start-2 text-[12.5px] leading-[1.55] text-muted-foreground">
          {{ canManageServers ? t('email.page.needServerBody') : t('email.page.needServerAsk') }}
        </p>
        <div v-if="canManageServers" class="col-start-2 mt-1.5 sm:col-start-3 sm:row-span-2 sm:row-start-1 sm:mt-0 sm:self-center">
          <Button variant="outline" size="sm" class="h-7 rounded-[7px] px-[9px] text-[13px]" @click="handleGoToServers">{{
            t('email.page.goToServers')
          }}</Button>
        </div>
      </div>

      <div class="mb-3 flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 sm:flex-nowrap">
        <h3 class="text-xs font-semibold tracking-[0.05em] whitespace-nowrap uppercase text-muted-foreground">{{ t('email.page.recipients') }}</h3>
        <p v-if="recipients.length > 0" class="order-3 min-w-0 basis-full text-[12.5px] text-muted-foreground sm:order-none sm:basis-auto">
          {{ t('email.page.recipientsHint') }}
        </p>
        <Button size="sm" class="ms-auto h-7 gap-[5px] rounded-[7px] px-[9px] text-[13px] has-[>svg]:px-[9px]" @click="handleAdd">
          <Plus :size="14" aria-hidden="true" />{{ t('email.page.addRecipient') }}
        </Button>
      </div>

      <div v-if="recipients.length === 0" class="settings-empty-state flex flex-col items-center gap-1.5 py-7">
        <EmailTile :icon="Tablet" color="var(--format-kindle)" :size="40" />
        <p class="text-sm font-semibold text-foreground">{{ t('email.page.recipientsEmptyTitle') }}</p>
        <i18n-t
          keypath="email.page.recipientsEmptyBody"
          tag="p"
          class="max-w-[440px] text-[12.5px] leading-[1.55] text-muted-foreground"
          scope="global"
        >
          <template #kindle><span class="font-mono text-foreground" dir="ltr">@kindle.com</span></template>
          <template #pocketbook><span class="font-mono text-foreground" dir="ltr">@pbsync.com</span></template>
        </i18n-t>
        <Button size="sm" class="mt-2 h-7 gap-[5px] rounded-[7px] px-[9px] text-[13px] has-[>svg]:px-[9px]" @click="handleAdd">
          <Plus :size="14" aria-hidden="true" />{{ t('email.page.addRecipient') }}
        </Button>
      </div>

      <template v-else>
        <ul class="settings-card">
          <li v-for="recipient in recipients" :key="recipient.id">
            <EmailRecipientRow
              :recipient="recipient"
              :is-default="recipient.id === defaultRecipientId"
              :busy="busy"
              @edit="handleEdit"
              @make-default="handleMakeDefault"
            />
          </li>
        </ul>

        <p v-if="hasKindle && senderAddress" class="mt-3 flex items-start gap-[9px] text-[12.5px] leading-[1.7] text-muted-foreground">
          <Info :size="14" class="mt-1 shrink-0 text-[var(--format-kindle)]" aria-hidden="true" />
          <i18n-t keypath="email.page.kindleNote" tag="span" scope="global">
            <template #address>
              <span
                class="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-foreground/6 py-px ps-[7px] pe-1 align-middle font-mono text-xs text-foreground"
                dir="ltr"
              >
                <span class="truncate">{{ senderAddress }}</span>
                <button
                  type="button"
                  class="inline-flex shrink-0 rounded-xs p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  :aria-label="t('email.page.copyAddress')"
                  @click="copySender"
                >
                  <Copy :size="13" aria-hidden="true" />
                </button>
              </span>
            </template>
          </i18n-t>
        </p>
      </template>
    </section>

    <section v-if="recipients.length > 0">
      <div class="mb-3 flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 sm:flex-nowrap">
        <h3 class="text-xs font-semibold tracking-[0.05em] whitespace-nowrap uppercase text-muted-foreground">{{ t('email.page.groups') }}</h3>
        <p class="order-3 min-w-0 basis-full text-[12.5px] text-muted-foreground sm:order-none sm:basis-auto">{{ t('email.page.groupsHint') }}</p>
        <Button
          variant="outline"
          size="sm"
          class="ms-auto h-7 gap-[5px] rounded-[7px] px-[9px] text-[13px] has-[>svg]:px-[9px]"
          @click="handleAddGroup"
        >
          <Plus :size="14" aria-hidden="true" />{{ t('email.page.newGroup') }}
        </Button>
      </div>
      <div v-if="groups.length === 0" class="settings-empty-state py-7">
        <p class="text-[12.5px] text-muted-foreground">{{ t('email.page.groupsEmpty') }}</p>
      </div>
      <ul v-else class="settings-card">
        <li v-for="group in groups" :key="group.id">
          <button
            type="button"
            class="group/row flex min-h-16 w-full items-center gap-x-3.5 px-3.5 py-3 text-start transition-colors hover:bg-foreground/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4"
            :aria-label="t('email.page.editGroup', { name: group.name })"
            @click="handleEditGroup(group)"
          >
            <EmailTile :icon="UsersRound" color="var(--pill-info)" :size="36" />
            <span class="min-w-0 flex-1">
              <span class="flex min-w-0 items-center gap-2 text-sm leading-[1.45] font-medium text-foreground">
                <span class="truncate">{{ group.name }}</span>
                <span class="text-xs font-normal tabular-nums text-muted-foreground">{{ formatNumber(group.members.length) }}</span>
              </span>
              <span class="mt-[3px] flex min-w-0 items-center gap-2">
                <span class="flex shrink-0 -space-x-[3px]" aria-hidden="true">
                  <UserAvatar
                    v-for="member in group.members.slice(0, 4)"
                    :key="member.id"
                    :name="member.name"
                    size-class="size-[22px] rounded-full ring-2 ring-card"
                    text-class="text-[9.5px]"
                  />
                </span>
                <span class="truncate text-xs text-muted-foreground">{{ memberNames(group) }}</span>
              </span>
            </span>
            <span
              class="inline-flex size-7 shrink-0 items-center justify-center text-muted-foreground transition-opacity sm:ms-4 sm:opacity-0 sm:group-hover/row:opacity-100 sm:group-focus-visible/row:opacity-100 [@media(hover:none)]:opacity-100"
              aria-hidden="true"
            >
              <Pencil :size="14" />
            </span>
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>
