<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, KeyRound, LockOpen, TriangleAlert } from '@lucide/vue'
import type { UserAttentionItem } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import UserAvatar from '@/components/UserAvatar.vue'
import { formatNumber } from '@/i18n/formatters'
import { relativeTimestamp } from '../lib/relative-time'

const props = defineProps<{ items: UserAttentionItem[]; total: number; busyUserId: number | null; passwordLoginEnabled: boolean }>()
const emit = defineEmits<{ unlock: [id: number]; sendResetLink: [id: number]; open: [id: number] }>()

const { t } = useI18n()

const collapsed = ref(false)

/** OIDC and shared accounts have no password here, so there is no link to send. */
function isResettable(item: UserAttentionItem): boolean {
  return props.passwordLoginEnabled && item.provisioningMethod !== 'oidc' && item.provisioningMethod !== 'shared'
}

function detail(item: UserAttentionItem): string {
  if (item.reason === 'locked' && item.lockedUntil) {
    return t('adminFeature.usersPage.attention.detail.unlocksIn', { when: relativeTimestamp(item.lockedUntil) })
  }
  const created = relativeTimestamp(item.createdAt)
  if (!isResettable(item)) return t('adminFeature.usersPage.attention.detail.created', { when: created })
  if (!item.resetLinkExpiresAt) return t('adminFeature.usersPage.attention.detail.created', { when: created })
  const expired = new Date(item.resetLinkExpiresAt).getTime() <= Date.now()
  return expired
    ? t('adminFeature.usersPage.attention.detail.linkExpired', { when: created })
    : t('adminFeature.usersPage.attention.detail.linkValid', { when: created, expiry: relativeTimestamp(item.resetLinkExpiresAt) })
}

function actionLabel(item: UserAttentionItem): string {
  if (item.reason === 'locked') return t('adminFeature.usersPage.attention.action.unlock')
  if (item.reason === 'neverSignedIn') return t('adminFeature.usersPage.attention.action.sendNewLink')
  return t('adminFeature.usersPage.attention.action.sendResetLink')
}

function unavailableHint(item: UserAttentionItem): string {
  if (!props.passwordLoginEnabled && item.provisioningMethod !== 'oidc' && item.provisioningMethod !== 'shared') {
    return t('adminFeature.usersPage.resetPasswordDisabledHintFull')
  }
  return item.provisioningMethod === 'oidc'
    ? t('adminFeature.usersPage.resetPasswordOidcHintFull')
    : t('adminFeature.usersPage.resetPasswordSharedHintFull')
}

const hiddenCount = computed(() => Math.max(0, props.total - props.items.length))

function toggleCollapsed() {
  collapsed.value = !collapsed.value
}

function requestUnlock(id: number) {
  emit('unlock', id)
}

function requestResetLink(id: number) {
  emit('sendResetLink', id)
}

function openUser(id: number) {
  emit('open', id)
}
</script>

<template>
  <section
    aria-labelledby="user-attention-heading"
    class="overflow-hidden rounded-lg border border-[var(--pill-warning)]/35 bg-[var(--pill-warning)]/6 shadow-xs"
  >
    <div class="flex items-center gap-3 px-4 py-2.5" :class="collapsed ? '' : 'border-b border-[var(--pill-warning)]/25'">
      <h3 id="user-attention-heading" class="flex items-center gap-2 whitespace-nowrap text-sm font-semibold text-[var(--pill-warning)]">
        <TriangleAlert :size="15" class="shrink-0" aria-hidden="true" />
        {{ t('adminFeature.usersPage.attention.title') }}
      </h3>
      <p class="hidden text-xs tabular-nums text-muted-foreground sm:block">
        {{ t('adminFeature.usersPage.attention.count', { count: total }) }}
      </p>
      <Button variant="ghost" size="sm" type="button" class="ms-auto" :aria-expanded="!collapsed" @click="toggleCollapsed">
        {{ collapsed ? t('adminFeature.usersPage.attention.expand') : t('adminFeature.usersPage.attention.collapse') }}
        <ChevronDown :size="14" class="transition-transform" :class="collapsed ? '' : 'rotate-180'" aria-hidden="true" />
      </Button>
    </div>

    <ul v-if="!collapsed" class="divide-y divide-[var(--pill-warning)]/15">
      <li v-for="item in items" :key="item.id" class="flex items-center gap-3 px-3 py-2.5 sm:px-4">
        <div class="flex min-w-0 flex-1 items-center gap-3">
          <UserAvatar :name="item.name" :avatar-url="item.avatarUrl" size-class="size-7 shrink-0" text-class="text-[11px]" />
          <div class="min-w-0">
            <i18n-t :keypath="`adminFeature.usersPage.attention.reason.${item.reason}`" tag="p" class="text-sm text-foreground" scope="global">
              <template #name>
                <button type="button" class="font-semibold hover:underline" @click="openUser(item.id)">{{ item.name }}</button>
              </template>
            </i18n-t>
            <p class="mt-0.5 truncate text-xs text-muted-foreground">{{ detail(item) }}</p>
          </div>
        </div>

        <div class="flex shrink-0 items-center gap-2">
          <Button
            v-if="item.reason === 'locked'"
            variant="outline"
            size="sm"
            type="button"
            :disabled="busyUserId === item.id"
            @click="requestUnlock(item.id)"
          >
            <LockOpen :size="14" aria-hidden="true" />
            <span class="hidden sm:inline">{{ actionLabel(item) }}</span>
            <span class="sr-only sm:hidden">{{ actionLabel(item) }}</span>
          </Button>
          <Button
            v-else-if="isResettable(item)"
            variant="outline"
            size="sm"
            type="button"
            :disabled="busyUserId === item.id"
            @click="requestResetLink(item.id)"
          >
            <KeyRound :size="14" aria-hidden="true" />
            <span class="hidden sm:inline">{{ actionLabel(item) }}</span>
            <span class="sr-only sm:hidden">{{ actionLabel(item) }}</span>
          </Button>
          <p v-else class="hidden max-w-56 text-xs text-muted-foreground sm:block">{{ unavailableHint(item) }}</p>
        </div>
      </li>
    </ul>

    <p v-if="!collapsed && hiddenCount > 0" class="border-t border-[var(--pill-warning)]/15 px-4 py-2 text-xs text-muted-foreground">
      {{ t('adminFeature.usersPage.attention.more', { count: formatNumber(hiddenCount) }) }}
    </p>
  </section>
</template>
