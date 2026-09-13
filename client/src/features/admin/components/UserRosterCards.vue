<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ChevronRight } from '@lucide/vue'

import UserAvatar from '@/components/UserAvatar.vue'
import { formatNumber } from '@/i18n/formatters'
import type { UserRow } from '../composables/useUsers'
import { accessTier } from '../lib/access-tier'
import { relativeTimestamp } from '../lib/relative-time'
import UserStatusCell from './UserStatusCell.vue'

const props = defineProps<{
  users: UserRow[]
  libraryTotal: number
  canManage: (user: UserRow) => boolean
  needsAttention: (user: UserRow) => boolean
}>()
const emit = defineEmits<{ open: [user: UserRow] }>()

const { t } = useI18n()

function accessLabel(user: UserRow): string {
  const tier = accessTier(user)
  const name = t(`adminFeature.usersPage.accessTier.${tier}`)
  return tier === 'custom' || tier === 'admin' ? `${name} · ${formatNumber(user.permissions?.length ?? 0)}` : name
}

/** One line instead of a pill row: a phone has no width for three separate chips. */
function metaLabel(user: UserRow): string {
  const lastActive = user.lastAuthenticatedAt ? relativeTimestamp(user.lastAuthenticatedAt) : t('adminFeature.usersPage.status.never')
  const granted = user.isSuperuser ? props.libraryTotal : (user.libraryAccessCount ?? 0)
  const libraries =
    props.libraryTotal > 0 && granted >= props.libraryTotal
      ? t('adminFeature.usersPage.libraries.all', { total: formatNumber(props.libraryTotal) })
      : t('adminFeature.usersPage.libraries.some', { granted: formatNumber(granted), total: formatNumber(props.libraryTotal) })
  return t('adminFeature.usersPage.cardMeta', { access: accessLabel(user), libraries, lastActive })
}

function openUser(user: UserRow) {
  if (!props.canManage(user)) return
  emit('open', user)
}
</script>

<template>
  <ul class="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-xs md:hidden">
    <li v-for="user in users" :key="user.id" :class="needsAttention(user) ? 'shadow-[inset_2px_0_0_var(--pill-warning)]' : ''">
      <button
        type="button"
        class="flex w-full items-center gap-3 px-3 py-2.5 text-start transition-colors hover:bg-foreground/4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none"
        :disabled="!canManage(user)"
        :aria-label="t('adminFeature.usersPage.editUserAria', { name: user.name })"
        @click="openUser(user)"
      >
        <UserAvatar :name="user.name" :avatar-url="user.avatarUrl" size-class="size-9 shrink-0" text-class="text-xs" />
        <div class="min-w-0 flex-1">
          <p class="truncate font-semibold text-foreground">{{ user.name }}</p>
          <p class="truncate font-mono text-xs text-muted-foreground">@{{ user.username }}</p>
          <p class="mt-1 truncate text-xs text-muted-foreground">{{ metaLabel(user) }}</p>
          <div class="mt-1.5"><UserStatusCell :user="user" /></div>
        </div>
        <ChevronRight v-if="canManage(user)" :size="16" class="shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
    </li>
  </ul>
</template>
