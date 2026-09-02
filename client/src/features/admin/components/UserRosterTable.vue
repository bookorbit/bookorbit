<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Library, MoreVertical, Pencil } from '@lucide/vue'
import type { UserListSortDirection, UserListSortField } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import UserAvatar from '@/components/UserAvatar.vue'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { formatNumber } from '@/i18n/formatters'
import type { UserRow } from '../composables/useUsers'
import { relativeTimestamp } from '../lib/relative-time'
import AccessTierBadge from './AccessTierBadge.vue'
import SortableColumnHeader from './SortableColumnHeader.vue'
import UserStatusCell from './UserStatusCell.vue'

const props = defineProps<{
  users: UserRow[]
  libraryTotal: number
  sortBy: UserListSortField
  sortDir: UserListSortDirection
  canManage: (user: UserRow) => boolean
  isLocked: (user: UserRow) => boolean
  isResettable: (user: UserRow) => boolean
  needsAttention: (user: UserRow) => boolean
  passwordLoginEnabled: boolean
}>()

const emit = defineEmits<{
  sort: [field: UserListSortField]
  edit: [user: UserRow]
  unlock: [user: UserRow]
  resetPassword: [user: UserRow]
  remove: [user: UserRow]
}>()

const { t } = useI18n()

function libraryLabel(user: UserRow): string {
  const total = formatNumber(props.libraryTotal)
  if (user.isSuperuser) return t('adminFeature.usersPage.libraries.all', { total })
  const granted = user.libraryAccessCount ?? 0
  if (props.libraryTotal > 0 && granted >= props.libraryTotal) return t('adminFeature.usersPage.libraries.all', { total })
  return t('adminFeature.usersPage.libraries.some', { granted: formatNumber(granted), total })
}

function lastActiveLabel(user: UserRow): string {
  return user.lastAuthenticatedAt ? relativeTimestamp(user.lastAuthenticatedAt) : t('adminFeature.usersPage.status.never')
}

function resetHint(user: UserRow): string {
  if (!props.passwordLoginEnabled && user.provisioningMethod !== 'oidc' && user.provisioningMethod !== 'shared') {
    return t('adminFeature.usersPage.resetPasswordDisabledHintFull')
  }
  if (user.provisioningMethod === 'oidc') return t('adminFeature.usersPage.resetPasswordOidcHintFull')
  return t('adminFeature.usersPage.resetPasswordSharedHintFull')
}

function requestSort(field: UserListSortField) {
  emit('sort', field)
}

function requestEdit(user: UserRow) {
  emit('edit', user)
}

function requestUnlock(user: UserRow) {
  emit('unlock', user)
}

function requestResetPassword(user: UserRow) {
  emit('resetPassword', user)
}

function requestRemove(user: UserRow) {
  emit('remove', user)
}
</script>

<template>
  <div class="hidden overflow-x-auto rounded-lg border border-border bg-card shadow-xs md:block">
    <table class="w-full min-w-[62rem] table-fixed text-sm">
      <colgroup>
        <col class="w-[22%]" />
        <col class="w-[17%]" />
        <col class="w-[11%]" />
        <col class="w-[9%]" />
        <col class="w-[14%]" />
        <col class="w-[17%]" />
        <col class="w-[10%]" />
      </colgroup>
      <thead class="bg-foreground/3">
        <tr>
          <SortableColumnHeader field="username" :sort-by="sortBy" :sort-dir="sortDir" @sort="requestSort">
            {{ t('adminFeature.usersPage.columns.user') }}
          </SortableColumnHeader>
          <SortableColumnHeader field="email" :sort-by="sortBy" :sort-dir="sortDir" @sort="requestSort">
            {{ t('adminFeature.usersPage.columns.email') }}
          </SortableColumnHeader>
          <th scope="col" class="px-3 py-2.5 text-start text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {{ t('adminFeature.usersPage.columns.access') }}
          </th>
          <th scope="col" class="px-3 py-2.5 text-start text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {{ t('adminFeature.usersPage.columns.libraries') }}
          </th>
          <SortableColumnHeader field="lastActive" :sort-by="sortBy" :sort-dir="sortDir" @sort="requestSort">
            {{ t('adminFeature.usersPage.columns.lastActive') }}
          </SortableColumnHeader>
          <th scope="col" class="px-3 py-2.5 text-start text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {{ t('adminFeature.usersPage.columns.status') }}
          </th>
          <th scope="col" class="px-3 py-2.5 text-end text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span class="sr-only">{{ t('adminFeature.usersPage.columns.actions') }}</span>
          </th>
        </tr>
      </thead>
      <tbody class="divide-y divide-border">
        <tr
          v-for="user in users"
          :key="user.id"
          class="group bg-card transition-colors hover:bg-foreground/4 focus-within:bg-foreground/4"
          :class="needsAttention(user) ? 'shadow-[inset_2px_0_0_var(--pill-warning)]' : ''"
        >
          <td class="px-3 py-2">
            <div class="flex items-center gap-2.5">
              <UserAvatar :name="user.name" :avatar-url="user.avatarUrl" size-class="size-8 shrink-0" text-class="text-[11px]" />
              <div class="min-w-0">
                <p class="truncate font-semibold text-foreground">{{ user.name }}</p>
                <p class="truncate font-mono text-xs text-muted-foreground">@{{ user.username }}</p>
              </div>
            </div>
          </td>
          <td class="px-3 py-2">
            <p v-if="user.email" class="truncate text-muted-foreground">{{ user.email }}</p>
            <p v-else class="text-muted-foreground">{{ t('adminFeature.usersPage.noEmail') }}</p>
          </td>
          <td class="px-3 py-2"><AccessTierBadge :user="user" /></td>
          <td class="px-3 py-2">
            <span class="inline-flex items-center gap-1.5 text-muted-foreground">
              <Library :size="13" class="shrink-0 opacity-70" aria-hidden="true" />
              <span class="truncate">{{ libraryLabel(user) }}</span>
            </span>
          </td>
          <td class="px-3 py-2">
            <span
              class="block truncate whitespace-nowrap tabular-nums"
              :class="user.lastAuthenticatedAt ? 'text-muted-foreground' : 'text-[var(--pill-warning)]'"
            >
              {{ lastActiveLabel(user) }}
            </span>
          </td>
          <td class="px-3 py-2"><UserStatusCell :user="user" /></td>
          <td class="px-3 py-2">
            <div v-if="canManage(user)" class="flex items-center justify-end gap-1">
              <Button
                variant="ghost"
                size="sm"
                type="button"
                class="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                @click="requestEdit(user)"
              >
                <Pencil :size="14" aria-hidden="true" />
                {{ t('common.edit') }}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button variant="ghost" size="icon-sm" type="button" :aria-label="t('adminFeature.usersPage.moreActionsAria', { name: user.name })">
                    <MoreVertical :size="16" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" class="w-60">
                  <DropdownMenuItem @click="requestEdit(user)">{{ t('adminFeature.usersPage.editAccount') }}</DropdownMenuItem>
                  <DropdownMenuItem v-if="isLocked(user)" @click="requestUnlock(user)">
                    {{ t('adminFeature.usersPage.unlockAccount') }}
                  </DropdownMenuItem>
                  <DropdownMenuItem v-if="isResettable(user)" @click="requestResetPassword(user)">
                    {{ t('adminFeature.usersPage.resetPassword') }}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem class="text-destructive focus:text-destructive" @click="requestRemove(user)">
                    {{ t('adminFeature.usersPage.deleteUserAction') }}
                  </DropdownMenuItem>
                  <template v-if="!isResettable(user)">
                    <DropdownMenuSeparator />
                    <p class="px-2 py-1.5 text-xs leading-4 text-muted-foreground">{{ resetHint(user) }}</p>
                  </template>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
