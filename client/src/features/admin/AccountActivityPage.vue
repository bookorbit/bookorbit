<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { ArrowUpRight, ChartPie, Clock3, Eye, EyeOff, Search, ShieldCheck, UserRoundCheck, UserRoundX, UsersRound } from '@lucide/vue'
import type {
  AccountActivityListItem,
  AccountActivitySortDirection,
  AccountActivitySortField,
  AccountActivityState,
  ReadingInsightsSharingLevel,
} from '@bookorbit/types'

import { formatDate, formatDateTime, formatNumber, formatRelativeTime } from '@/i18n/formatters'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAccountActivity } from './composables/useAccountActivity'

const { t } = useI18n()
const router = useRouter()
const activity = useAccountActivity()
type SortSelection = 'lastAuthenticatedAt:desc' | 'lastAuthenticatedAt:asc' | 'lastLoginAt:desc' | 'createdAt:desc' | 'createdAt:asc' | 'name:asc'

const sortSelection = computed<SortSelection>({
  get: () => `${activity.sortBy.value}:${activity.sortDir.value}` as SortSelection,
  set: (value) => {
    const [sortBy, sortDir] = value.split(':') as [AccountActivitySortField, AccountActivitySortDirection]
    activity.sortBy.value = sortBy
    activity.sortDir.value = sortDir
  },
})

const summaryCards = computed(() => [
  { state: 'recent' as const, count: activity.summary.value.recent, icon: UserRoundCheck },
  { state: 'dormant' as const, count: activity.summary.value.dormant, icon: Clock3 },
  { state: 'never' as const, count: activity.summary.value.never, icon: UsersRound },
  { state: 'disabled' as const, count: activity.summary.value.disabled, icon: UserRoundX },
])
const hasActiveFilters = computed(
  () =>
    activity.search.value.length > 0 ||
    activity.state.value.length > 0 ||
    activity.provisioningMethod.value.length > 0 ||
    activity.sortBy.value !== 'lastAuthenticatedAt' ||
    activity.sortDir.value !== 'desc',
)

onMounted(activity.load)

function handleApplyFilters() {
  activity.page.value = 1
  void activity.load()
}

function selectSummaryState(state: AccountActivityState) {
  activity.state.value = activity.state.value === state ? '' : state
  handleApplyFilters()
}

function handleClearFilters() {
  activity.search.value = ''
  activity.state.value = ''
  activity.provisioningMethod.value = ''
  activity.sortBy.value = 'lastAuthenticatedAt'
  activity.sortDir.value = 'desc'
  handleApplyFilters()
}

function handlePreviousPage() {
  if (activity.page.value <= 1) return
  activity.page.value--
  void activity.load()
}

function handleNextPage() {
  if (activity.page.value >= activity.totalPages.value) return
  activity.page.value++
  void activity.load()
}

function openSharedInsights(item: AccountActivityListItem) {
  router.push({ name: 'settings-admin-shared-insights', params: { userId: item.id } })
}

function relativeTimestamp(value: string | null): string {
  if (!value) return t('adminFeature.accountActivity.never')
  const differenceMs = new Date(value).getTime() - Date.now()
  const absoluteMs = Math.abs(differenceMs)
  if (absoluteMs < 60 * 60 * 1000) return formatRelativeTime(Math.round(differenceMs / 60_000), 'minute')
  if (absoluteMs < 24 * 60 * 60 * 1000) return formatRelativeTime(Math.round(differenceMs / 3_600_000), 'hour')
  if (absoluteMs < 30 * 24 * 60 * 60 * 1000) return formatRelativeTime(Math.round(differenceMs / 86_400_000), 'day')
  if (absoluteMs < 365 * 24 * 60 * 60 * 1000) return formatRelativeTime(Math.round(differenceMs / 2_592_000_000), 'month')
  return formatRelativeTime(Math.round(differenceMs / 31_536_000_000), 'year')
}

function exactTimestamp(value: string | null): string {
  return value ? formatDateTime(new Date(value)) : t('adminFeature.accountActivity.never')
}

function compactDate(value: string): string {
  return formatDate(new Date(value), { year: 'numeric', month: 'short', day: 'numeric' })
}

function stateClasses(state: AccountActivityState): string {
  if (state === 'recent') return 'bg-primary/15 text-primary'
  if (state === 'dormant') return 'bg-secondary text-secondary-foreground'
  if (state === 'disabled') return 'bg-destructive/15 text-destructive'
  return 'bg-muted text-muted-foreground'
}

function summaryCardClasses(state: AccountActivityState): string {
  return activity.state.value === state ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/40'
}

function sharingClasses(level: ReadingInsightsSharingLevel): string {
  if (level === 'detailed') return 'border-primary/35 bg-primary/10 text-primary hover:bg-primary/20'
  if (level === 'summary') return 'border-accent bg-accent/60 text-accent-foreground hover:bg-accent'
  return 'border-border bg-muted text-muted-foreground'
}

function sharingIcon(level: ReadingInsightsSharingLevel) {
  if (level === 'detailed') return Eye
  if (level === 'summary') return ChartPie
  return EyeOff
}
</script>

<template>
  <section aria-labelledby="account-activity-heading" class="space-y-4">
    <div>
      <div class="flex items-center gap-2">
        <h2 id="account-activity-heading" class="text-lg font-semibold text-foreground">{{ t('adminFeature.accountActivity.title') }}</h2>
        <Tooltip>
          <TooltipTrigger as-child>
            <button
              type="button"
              class="inline-flex size-7 items-center justify-center rounded-full bg-primary/15 text-primary transition-colors hover:bg-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :aria-label="t('adminFeature.accountActivity.privacyLabel')"
            >
              <ShieldCheck :size="15" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" class="max-w-sm text-xs leading-relaxed">
            {{ t('adminFeature.accountActivity.privacyNotice') }}
          </TooltipContent>
        </Tooltip>
      </div>
      <p class="mt-1 text-sm text-muted-foreground">{{ t('adminFeature.accountActivity.subtitle') }}</p>
    </div>

    <div class="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <button
        v-for="card in summaryCards"
        :key="card.state"
        type="button"
        class="flex items-center gap-3 rounded-lg border p-3 text-start shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :class="summaryCardClasses(card.state)"
        :aria-pressed="activity.state.value === card.state"
        @click="selectSummaryState(card.state)"
      >
        <span class="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <component :is="card.icon" :size="16" aria-hidden="true" />
        </span>
        <span class="min-w-0">
          <span class="block text-lg font-semibold leading-none text-foreground">{{ formatNumber(card.count) }}</span>
          <span class="mt-1 block text-xs leading-tight text-muted-foreground">{{ t(`adminFeature.accountActivity.states.${card.state}`) }}</span>
        </span>
      </button>
    </div>

    <form
      class="grid gap-2 rounded-lg border border-border bg-card p-2 md:grid-cols-2 xl:grid-cols-[minmax(12rem,1fr)_minmax(9rem,auto)_minmax(11rem,auto)_minmax(10rem,auto)_auto_auto]"
      @submit.prevent="handleApplyFilters"
    >
      <label class="relative block">
        <span class="sr-only">{{ t('adminFeature.accountActivity.filters.search') }}</span>
        <Search :size="15" class="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          v-model="activity.search.value"
          type="search"
          class="h-9 w-full rounded-md border border-input bg-background ps-9 pe-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :placeholder="t('adminFeature.accountActivity.filters.searchPlaceholder')"
        />
      </label>
      <label>
        <span class="sr-only">{{ t('adminFeature.accountActivity.filters.state') }}</span>
        <select
          v-model="activity.state.value"
          class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          @change="handleApplyFilters"
        >
          <option value="">{{ t('adminFeature.accountActivity.filters.allStates') }}</option>
          <option value="recent">{{ t('adminFeature.accountActivity.states.recent') }}</option>
          <option value="dormant">{{ t('adminFeature.accountActivity.states.dormant') }}</option>
          <option value="never">{{ t('adminFeature.accountActivity.states.never') }}</option>
          <option value="disabled">{{ t('adminFeature.accountActivity.states.disabled') }}</option>
        </select>
      </label>
      <label>
        <span class="sr-only">{{ t('adminFeature.accountActivity.filters.provisioning') }}</span>
        <select
          v-model="activity.provisioningMethod.value"
          class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          @change="handleApplyFilters"
        >
          <option value="">{{ t('adminFeature.accountActivity.filters.allMethods') }}</option>
          <option value="local">{{ t('adminFeature.accountActivity.methods.local') }}</option>
          <option value="manual">{{ t('adminFeature.accountActivity.methods.manual') }}</option>
          <option value="oidc">{{ t('adminFeature.accountActivity.methods.oidc') }}</option>
          <option value="shared">{{ t('adminFeature.accountActivity.methods.shared') }}</option>
        </select>
      </label>
      <label>
        <span class="sr-only">{{ t('adminFeature.accountActivity.filters.sort') }}</span>
        <select v-model="sortSelection" class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" @change="handleApplyFilters">
          <option value="lastAuthenticatedAt:desc">{{ t('adminFeature.accountActivity.filters.mostRecent') }}</option>
          <option value="lastAuthenticatedAt:asc">{{ t('adminFeature.accountActivity.filters.leastRecent') }}</option>
          <option value="lastLoginAt:desc">{{ t('adminFeature.accountActivity.filters.lastLogin') }}</option>
          <option value="createdAt:desc">{{ t('adminFeature.accountActivity.filters.newest') }}</option>
          <option value="createdAt:asc">{{ t('adminFeature.accountActivity.filters.oldest') }}</option>
          <option value="name:asc">{{ t('adminFeature.accountActivity.filters.name') }}</option>
        </select>
      </label>
      <button type="submit" class="settings-btn-primary h-9 justify-center">{{ t('adminFeature.accountActivity.filters.apply') }}</button>
      <button v-if="hasActiveFilters" type="button" class="settings-btn-outline h-9 justify-center" @click="handleClearFilters">
        {{ t('adminFeature.accountActivity.filters.clear') }}
      </button>
    </form>

    <p v-if="activity.error.value" role="alert" class="text-sm text-destructive">{{ t('adminFeature.accountActivity.errors.load') }}</p>
    <p v-else-if="activity.loading.value" role="status" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>
    <div v-else-if="activity.items.value.length === 0" class="rounded-lg border border-dashed border-border px-4 py-8 text-center">
      <p class="text-sm font-medium text-foreground">{{ t('adminFeature.accountActivity.empty.title') }}</p>
      <p class="mt-1 text-sm text-muted-foreground">{{ t('adminFeature.accountActivity.empty.description') }}</p>
    </div>

    <template v-else>
      <div class="hidden overflow-x-auto rounded-lg border border-border shadow-xs md:block">
        <table class="w-full min-w-[960px] table-fixed text-sm">
          <colgroup>
            <col class="w-[24%]" />
            <col class="w-[14%]" />
            <col class="w-[13%]" />
            <col class="w-[16%]" />
            <col class="w-[15%]" />
            <col class="w-[18%]" />
          </colgroup>
          <thead class="bg-muted/50 text-muted-foreground">
            <tr>
              <th class="px-3 py-2 text-start text-xs font-medium">{{ t('adminFeature.accountActivity.columns.user') }}</th>
              <th class="px-3 py-2 text-start text-xs font-medium">{{ t('adminFeature.accountActivity.columns.state') }}</th>
              <th class="px-3 py-2 text-start text-xs font-medium">{{ t('adminFeature.accountActivity.columns.lastLogin') }}</th>
              <th class="px-3 py-2 text-start text-xs font-medium">{{ t('adminFeature.accountActivity.columns.lastAuthenticated') }}</th>
              <th class="px-3 py-2 text-start text-xs font-medium">{{ t('adminFeature.accountActivity.columns.created') }}</th>
              <th class="px-3 py-2 text-end text-xs font-medium">{{ t('adminFeature.accountActivity.columns.readingInsights') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            <tr v-for="item in activity.items.value" :key="item.id" class="bg-card hover:bg-muted/30">
              <td class="px-3 py-2">
                <p class="truncate font-medium text-foreground">{{ item.name }}</p>
                <p class="truncate text-[11px] text-muted-foreground">
                  <span class="font-mono">@{{ item.username }}</span>
                  <span aria-hidden="true"> · </span>
                  {{ t(`adminFeature.accountActivity.methods.${item.provisioningMethod}`) }}
                </p>
              </td>
              <td class="px-3 py-2">
                <span class="inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium" :class="stateClasses(item.state)">
                  {{ t(`adminFeature.accountActivity.states.${item.state}`) }}
                </span>
              </td>
              <td class="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground" :title="exactTimestamp(item.lastLoginAt)">
                {{ relativeTimestamp(item.lastLoginAt) }}
              </td>
              <td class="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground" :title="exactTimestamp(item.lastAuthenticatedAt)">
                {{ relativeTimestamp(item.lastAuthenticatedAt) }}
              </td>
              <td class="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground" :title="exactTimestamp(item.createdAt)">
                {{ compactDate(item.createdAt) }}
              </td>
              <td class="px-3 py-2 text-end">
                <button
                  v-if="item.readingInsightsSharingLevel !== 'private'"
                  type="button"
                  class="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  :class="sharingClasses(item.readingInsightsSharingLevel)"
                  :aria-label="t('adminFeature.accountActivity.openInsightsFor', { name: item.name })"
                  @click="openSharedInsights(item)"
                >
                  <component :is="sharingIcon(item.readingInsightsSharingLevel)" :size="12" aria-hidden="true" />
                  {{ t(`adminFeature.accountActivity.sharing.${item.readingInsightsSharingLevel}`) }}
                  <ArrowUpRight :size="11" aria-hidden="true" />
                </button>
                <span
                  v-else
                  class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px]"
                  :class="sharingClasses(item.readingInsightsSharingLevel)"
                >
                  <component :is="sharingIcon(item.readingInsightsSharingLevel)" :size="12" aria-hidden="true" />
                  {{ t(`adminFeature.accountActivity.sharing.${item.readingInsightsSharingLevel}`) }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="space-y-2 md:hidden">
        <article v-for="item in activity.items.value" :key="item.id" class="rounded-lg border border-border bg-card p-3 shadow-xs">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="truncate font-medium text-foreground">{{ item.name }}</p>
              <p class="truncate font-mono text-xs text-muted-foreground">@{{ item.username }}</p>
            </div>
            <span class="shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium" :class="stateClasses(item.state)">
              {{ t(`adminFeature.accountActivity.states.${item.state}`) }}
            </span>
          </div>
          <dl class="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt class="text-xs text-muted-foreground">{{ t('adminFeature.accountActivity.columns.lastLogin') }}</dt>
              <dd class="mt-0.5 text-foreground">{{ relativeTimestamp(item.lastLoginAt) }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted-foreground">{{ t('adminFeature.accountActivity.columns.lastAuthenticated') }}</dt>
              <dd class="mt-0.5 text-foreground">{{ relativeTimestamp(item.lastAuthenticatedAt) }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted-foreground">{{ t('adminFeature.accountActivity.columns.created') }}</dt>
              <dd class="mt-0.5 text-foreground">{{ compactDate(item.createdAt) }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted-foreground">{{ t('adminFeature.accountActivity.filters.provisioning') }}</dt>
              <dd class="mt-0.5 text-foreground">{{ t(`adminFeature.accountActivity.methods.${item.provisioningMethod}`) }}</dd>
            </div>
          </dl>
          <div class="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
            <span class="text-xs text-muted-foreground">{{ t('adminFeature.accountActivity.columns.readingInsights') }}</span>
            <button
              v-if="item.readingInsightsSharingLevel !== 'private'"
              type="button"
              class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :class="sharingClasses(item.readingInsightsSharingLevel)"
              :aria-label="t('adminFeature.accountActivity.openInsightsFor', { name: item.name })"
              @click="openSharedInsights(item)"
            >
              <component :is="sharingIcon(item.readingInsightsSharingLevel)" :size="12" aria-hidden="true" />
              {{ t(`adminFeature.accountActivity.sharing.${item.readingInsightsSharingLevel}`) }}
              <ArrowUpRight :size="11" aria-hidden="true" />
            </button>
            <span
              v-else
              class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px]"
              :class="sharingClasses(item.readingInsightsSharingLevel)"
            >
              <component :is="sharingIcon(item.readingInsightsSharingLevel)" :size="12" aria-hidden="true" />
              {{ t(`adminFeature.accountActivity.sharing.${item.readingInsightsSharingLevel}`) }}
            </span>
          </div>
        </article>
      </div>

      <nav
        v-if="activity.totalPages.value > 1"
        :aria-label="t('adminFeature.accountActivity.pagination.label')"
        class="flex items-center justify-between gap-3"
      >
        <p class="text-sm text-muted-foreground">
          {{
            t('adminFeature.accountActivity.pagination.page', {
              page: formatNumber(activity.page.value),
              totalPages: formatNumber(activity.totalPages.value),
            })
          }}
        </p>
        <div class="flex gap-2">
          <button type="button" class="settings-btn-outline" :disabled="activity.page.value <= 1" @click="handlePreviousPage">
            {{ t('common.previous') }}
          </button>
          <button type="button" class="settings-btn-outline" :disabled="activity.page.value >= activity.totalPages.value" @click="handleNextPage">
            {{ t('common.next') }}
          </button>
        </div>
      </nav>
    </template>
  </section>
</template>
