<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RefreshCw, ShieldCheck, TriangleAlert, UserPlus, X } from '@lucide/vue'
import type { AccessLevel } from '@bookorbit/types'
import { formatList } from '@/i18n/formatters'
import { LIBRARY_ACCESS_KEY } from '../composables/useLibraryAccess'
import LibraryCreatorCard from './LibraryCreatorCard.vue'

const { t } = useI18n()

const props = defineProps<{
  libraryId: number | null
}>()

const access = inject(LIBRARY_ACCESS_KEY)
if (!access) throw new Error('LibraryCreatorAccess needs the library access state provided by LibraryCreatorModal')
const { entries, pending, loading, busy, loaded, error, availableUsers, failedGrants, load, grant, changeLevel, revoke, applyPending } = access

const LEVELS: AccessLevel[] = ['viewer', 'editor', 'owner']

const grantUserId = ref<number | null>(null)
const grantLevel = ref<AccessLevel>('viewer')
const confirmingRevoke = ref<number | null>(null)

interface PersonRow {
  userId: number
  name: string
  username: string
  accessLevel: AccessLevel
  queued: boolean
}

const people = computed<PersonRow[]>(() => [
  ...entries.value.map((entry) => ({
    userId: entry.userId,
    name: entry.name,
    username: entry.username,
    accessLevel: entry.accessLevel,
    queued: false,
  })),
  ...pending.value
    .filter((grant) => !grant.failed)
    .map((grant) => ({ userId: grant.userId, name: grant.name, username: grant.username, accessLevel: grant.accessLevel, queued: true })),
])
const failedNames = computed(() => formatList(failedGrants.value.map((grant) => grant.name || grant.username)))

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('')
}

async function handleGrant() {
  if (grantUserId.value === null) return
  if (await grant(grantUserId.value, grantLevel.value)) grantUserId.value = null
}

function handleLevelChange(row: PersonRow, event: Event) {
  void changeLevel(row.userId, (event.target as HTMLSelectElement).value as AccessLevel)
}

function handleRemove(row: PersonRow) {
  if (row.queued) {
    void revoke(row.userId)
    return
  }
  confirmingRevoke.value = row.userId
}

function cancelRevoke() {
  confirmingRevoke.value = null
}

async function confirmRevoke(row: PersonRow) {
  confirmingRevoke.value = null
  await revoke(row.userId)
}

function retryFailed() {
  void applyPending()
}

onMounted(() => {
  if (!loaded.value && !loading.value) void load()
})
</script>

<template>
  <div class="flex flex-col gap-3">
    <div v-if="failedGrants.length > 0" role="alert" class="flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-3">
      <TriangleAlert :size="16" class="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-foreground">{{ t('library.creator.access.failed.title', { count: failedGrants.length }) }}</p>
        <p class="mt-0.5 text-xs text-muted-foreground">{{ t('library.creator.access.failed.body', { names: failedNames }) }}</p>
      </div>
      <button
        type="button"
        class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-[13px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
        :disabled="busy || props.libraryId === null"
        @click="retryFailed"
      >
        <RefreshCw :size="13" :class="busy ? 'motion-safe:animate-spin' : ''" aria-hidden="true" />
        {{ t('common.retry') }}
      </button>
    </div>

    <LibraryCreatorCard flush :label="t('library.creator.access.peopleTitle')" label-id="library-access-title">
      <template #meta>
        <span v-if="people.length > 0" class="tabular-nums">{{ t('library.creator.access.peopleCount', { count: people.length }) }}</span>
        <span v-else-if="libraryId === null">{{ t('library.creator.optional') }}</span>
      </template>

      <form class="flex flex-wrap gap-2 border-t border-border px-3 py-2.5" @submit.prevent="handleGrant">
        <div class="relative min-w-0 flex-[1_1_12rem]">
          <UserPlus :size="15" class="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <select
            id="library-access-user"
            v-model="grantUserId"
            :aria-label="t('library.creator.access.userSelectAria')"
            class="h-9 w-full rounded-md border border-input bg-background pe-3 ps-9 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            :disabled="loading || busy"
          >
            <option :value="null" disabled>{{ t('library.creator.access.selectUser') }}</option>
            <option v-for="user in availableUsers" :key="user.id" :value="user.id">{{ user.name }} (@{{ user.username }})</option>
          </select>
        </div>
        <select
          id="library-access-level"
          v-model="grantLevel"
          :aria-label="t('library.creator.access.levelSelectAria')"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          :disabled="loading || busy"
        >
          <option v-for="level in LEVELS" :key="level" :value="level">{{ t(`library.creator.access.levels.${level}`) }}</option>
        </select>
        <button
          type="submit"
          class="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          :disabled="grantUserId === null || loading || busy"
        >
          {{ libraryId === null ? t('library.creator.access.add') : t('library.creator.access.grant') }}
        </button>
      </form>

      <p v-if="error" role="alert" class="border-t border-border px-4 py-2 text-xs text-destructive">{{ error }}</p>

      <p v-if="loading && !loaded" class="border-t border-border px-4 py-5 text-center text-xs text-muted-foreground">
        {{ t('library.creator.access.loading') }}
      </p>
      <ul v-else-if="people.length > 0" class="divide-y divide-border border-t border-border" aria-labelledby="library-access-title">
        <li v-for="row in people" :key="row.userId" class="flex min-h-12 items-center gap-2.5 px-3 py-2">
          <span
            class="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground"
            aria-hidden="true"
          >
            {{ initials(row.name || row.username) }}
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[13px] font-medium text-foreground">{{ row.name || row.username }}</span>
            <span class="block truncate font-mono text-[11.5px] text-muted-foreground">@{{ row.username }}</span>
          </span>
          <template v-if="confirmingRevoke === row.userId">
            <span class="text-xs text-foreground">{{ t('library.creator.access.revokeQuestion') }}</span>
            <button
              type="button"
              class="h-8 rounded-md bg-destructive px-2.5 text-xs font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-50"
              :disabled="busy"
              @click="confirmRevoke(row)"
            >
              {{ t('library.creator.access.revoke') }}
            </button>
            <button type="button" class="h-8 rounded-md px-2.5 text-xs font-medium text-foreground hover:bg-muted" @click="cancelRevoke">
              {{ t('library.creator.access.keep') }}
            </button>
          </template>
          <template v-else>
            <select
              :value="row.accessLevel"
              :aria-label="t('library.creator.access.levelFor', { name: row.name || row.username })"
              :disabled="busy"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              @change="handleLevelChange(row, $event)"
            >
              <option v-for="level in LEVELS" :key="level" :value="level">{{ t(`library.creator.access.levels.${level}`) }}</option>
            </select>
            <button
              type="button"
              class="flex size-8 shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
              :aria-label="t('library.creator.access.revokeFor', { name: row.name || row.username })"
              :disabled="busy"
              @click="handleRemove(row)"
            >
              <X :size="15" aria-hidden="true" />
            </button>
          </template>
        </li>
      </ul>
      <p v-else class="border-t border-border px-4 py-5 text-center text-xs text-muted-foreground">
        {{ libraryId === null ? t('library.creator.access.emptyCreate') : t('library.creator.access.empty') }}
      </p>
    </LibraryCreatorCard>

    <p class="flex items-center gap-1.5 text-xs text-muted-foreground">
      <ShieldCheck :size="13" class="shrink-0" aria-hidden="true" />
      {{ t('library.creator.access.superusers') }}
    </p>
  </div>
</template>
