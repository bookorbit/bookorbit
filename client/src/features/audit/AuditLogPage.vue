<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMediaQuery } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { ChevronLeft, ChevronRight, Search, TriangleAlert, X } from '@lucide/vue'
import { AUDIT_SECURITY_GROUP_KEYS, Permission, type AuditLogEntry, type AuditSecurityGroup } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { formatNumber } from '@/i18n/formatters'
import { getAuditPerson } from './audit-display'
import { foldAuditEvents, localDayKey, type AuditEventSet } from './audit-sets'
import { AUDIT_PAGE_SIZE, useAuditLog, type AuditRangePreset, type AuditView } from './useAuditLog'
import { useAuditFormat } from './useAuditFormat'
import AuditCategoryTile from './components/AuditCategoryTile.vue'
import AuditDateRangeMenu from './components/AuditDateRangeMenu.vue'
import AuditEventSheet from './components/AuditEventSheet.vue'
import AuditFiltersMenu from './components/AuditFiltersMenu.vue'
import AuditHeaderActions from './components/AuditHeaderActions.vue'
import AuditLedgerList from './components/AuditLedgerList.vue'
import AuditLedgerTable from './components/AuditLedgerTable.vue'
import AuditPersonLabel from './components/AuditPersonLabel.vue'
import AuditSignInTable from './components/AuditSignInTable.vue'

const HEADER_ACTIONS_TARGET = '#settings-header-actions'
const VIEWS: AuditView[] = ['changes', 'signins', 'security', 'all']

withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })
const { t } = useI18n()
const format = useAuditFormat()
const { hasPermission } = usePermissions()
const audit = useAuditLog()
const {
  view,
  search,
  person,
  category,
  securityGroup,
  target,
  ip,
  range,
  page,
  entries,
  total,
  signIns,
  signInTotal,
  summary,
  actors,
  loading,
  loaded,
  error,
  activeFilterCount,
  totalPages,
} = audit
const isNarrow = useMediaQuery('(max-width: 767px)')
const headerSlotAvailable = ref(false)
const openSet = ref<AuditEventSet | null>(null)

const canEditRetention = computed(() => hasPermission(Permission.ManageAppSettings))
const sets = computed(() => foldAuditEvents(entries.value))
const unit = computed(() => (view.value === 'changes' ? 'changes' : 'events'))
const rowCount = computed(() => (view.value === 'signins' ? signIns.value.length : sets.value.length))
const listTotal = computed(() => (view.value === 'signins' ? signInTotal.value : total.value))
const hasFilters = computed(() => activeFilterCount.value > 0 || !!search.value.trim() || range.preset !== 'all' || !!securityGroup.value)

const securityChips = computed(() =>
  AUDIT_SECURITY_GROUP_KEYS.map((group) => ({ group, count: summary.value?.securityGroups[group] ?? 0 })).filter(
    (chip) => chip.count > 0 || chip.group === securityGroup.value,
  ),
)

const pagerText = computed(() => {
  if (view.value === 'signins')
    return t('audit.signIns.footer', { events: formatNumber(summary.value?.kinds.signins ?? 0), count: signInTotal.value })
  const from = (page.value - 1) * AUDIT_PAGE_SIZE + 1
  const to = Math.min(page.value * AUDIT_PAGE_SIZE, total.value)
  return t(`audit.pager.${unit.value}`, { from: formatNumber(from), to: formatNumber(to), count: total.value })
})

/** Up to five page buttons around the current page. */
const pageNumbers = computed(() => {
  const last = totalPages.value
  const start = Math.max(1, Math.min(page.value - 2, last - 4))
  return Array.from({ length: Math.min(5, last) }, (_, index) => start + index)
})

function viewCount(item: AuditView): number | null {
  if (!summary.value) return null
  return summary.value.kinds[item]
}

function selectView(item: AuditView) {
  view.value = item
  openSet.value = null
}

function selectGroup(group: AuditSecurityGroup | null) {
  securityGroup.value = securityGroup.value === group ? null : group
}

function showAllSecurity() {
  selectGroup(null)
}

function changeRange(next: { preset: AuditRangePreset; from: string; to: string }) {
  range.preset = next.preset
  range.from = next.from
  range.to = next.to
}

function openEvent(set: AuditEventSet) {
  openSet.value = set
}

function closeEvent() {
  openSet.value = null
}

function selectEntry(entry: AuditLogEntry) {
  openSet.value = { id: entry.id, first: entry, items: [entry], actions: [{ action: entry.action, count: 1 }], day: localDayKey(entry.createdAt) }
}

function onlyPerson(entry: AuditLogEntry) {
  const who = getAuditPerson(entry)
  person.value = { username: entry.actorUsername, name: who.kind === 'system' ? t('audit.person.system') : who.name }
  openSet.value = null
}

function onlyTarget(entry: AuditLogEntry, label: string) {
  if (!entry.resource || entry.resourceId === null) return
  target.value = { resource: entry.resource, resourceId: entry.resourceId, label }
  openSet.value = null
}

function onlyIp(address: string) {
  ip.value = address
  openSet.value = null
}

function removePerson() {
  person.value = null
}

function removeCategory() {
  category.value = null
}

function removeTarget() {
  target.value = null
}

function removeIp() {
  ip.value = null
}

function clearAll() {
  audit.clearFilters()
}

function loadActors() {
  if (actors.value.length === 0) void audit.fetchActors()
}

function previousPage() {
  if (page.value > 1) page.value--
}

function nextPage() {
  if (page.value < totalPages.value) page.value++
}

function goToPage(number: number) {
  page.value = number
}

async function handleExport(kind: 'csv' | 'json') {
  try {
    await audit.exportLog(kind)
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : t('audit.export.failed'))
  }
}

async function handleSaveRetention(days: number) {
  try {
    await audit.saveRetention(days)
    toast.success(t('audit.retention.saved', { count: days }))
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : t('audit.retention.saveFailed'))
  }
}

onMounted(() => {
  headerSlotAvailable.value = document.getElementById(HEADER_ACTIONS_TARGET.slice(1)) !== null
  void audit.refresh()
  void audit.fetchActors()
})
</script>

<template>
  <div class="space-y-4">
    <Teleport :to="HEADER_ACTIONS_TARGET" defer :disabled="!headerSlotAvailable">
      <AuditHeaderActions
        :retention-days="summary?.retentionDays ?? null"
        :oldest-at="summary?.oldestAt ?? null"
        :can-edit-retention="canEditRetention"
        @save-retention="handleSaveRetention"
        @export="handleExport"
      />
    </Teleport>

    <div class="flex flex-wrap items-center gap-2">
      <label class="relative block min-w-0 flex-1 basis-60">
        <span class="sr-only">{{ t('audit.search.label') }}</span>
        <Search :size="15" class="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          id="audit-search"
          v-model="search"
          type="search"
          class="input-field h-9 w-full ps-9 pe-3"
          :placeholder="isNarrow ? t('audit.search.placeholderShort') : t('audit.search.placeholder')"
        />
      </label>
      <div
        role="group"
        :aria-label="t('audit.views.label')"
        class="flex min-w-0 gap-0.5 overflow-x-auto rounded-lg border border-border bg-muted p-0.5 max-md:order-last max-md:basis-full"
      >
        <button
          v-for="item in VIEWS"
          :key="item"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:flex-1 max-md:justify-center max-md:px-2"
          :class="view === item ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
          :aria-pressed="view === item"
          @click="selectView(item)"
        >
          {{ t(`audit.views.${item}`) }}
          <span
            v-if="viewCount(item) !== null"
            class="rounded-xs px-1 text-xs tabular-nums"
            :class="view === item ? 'bg-primary/15 text-primary' : 'bg-foreground/8 text-muted-foreground max-md:hidden'"
          >
            {{ formatNumber(viewCount(item) ?? 0) }}
          </span>
        </button>
      </div>
      <AuditDateRangeMenu :preset="range.preset" :from="range.from" :to="range.to" :oldest-at="summary?.oldestAt ?? null" @change="changeRange" />
      <AuditFiltersMenu
        v-model:category="category"
        v-model:person="person"
        :category-counts="summary?.categories ?? {}"
        :actors="actors"
        :active-count="(person ? 1 : 0) + (category ? 1 : 0)"
        @clear="clearAll"
        @opened="loadActors"
      />
    </div>

    <div v-if="activeFilterCount > 0" class="-mt-1.5 flex flex-wrap items-center gap-1.5">
      <button
        v-if="person"
        type="button"
        class="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-border bg-card ps-1 pe-2 text-[13px] font-medium text-foreground hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-label="t('audit.removeFilter', { value: person.name })"
        @click="removePerson"
      >
        <AuditPersonLabel
          :person="{ kind: person.username === 'system' ? 'system' : 'user', name: person.name, username: person.username }"
          size="xs"
          :show-meta="false"
          class="min-w-0"
        />
        <X :size="12" class="shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
      <button
        v-if="category"
        type="button"
        class="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-card ps-1 pe-2 text-[13px] font-medium text-foreground hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-label="t('audit.removeFilter', { value: t(`audit.categories.${category}`) })"
        @click="removeCategory"
      >
        <AuditCategoryTile :category="category" size="xs" />
        {{ t(`audit.categories.${category}`) }}
        <X :size="12" class="text-muted-foreground" aria-hidden="true" />
      </button>
      <button
        v-if="target"
        type="button"
        class="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-border bg-card ps-2.5 pe-2 text-[13px] font-medium text-foreground hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-label="t('audit.removeFilter', { value: target.label })"
        @click="removeTarget"
      >
        <span class="truncate">{{ t('audit.activeFilters.target', { type: format.resourceLabel(target.resource), name: target.label }) }}</span>
        <X :size="12" class="shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
      <button
        v-if="ip"
        type="button"
        class="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-[13px] font-medium text-foreground hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-label="t('audit.removeFilter', { value: ip })"
        @click="removeIp"
      >
        <span class="font-mono text-xs">{{ ip }}</span>
        <X :size="12" class="text-muted-foreground" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="rounded-sm px-1.5 text-[13px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @click="clearAll"
      >
        {{ t('audit.activeFilters.clearAll') }}
      </button>
    </div>

    <div
      v-if="view === 'security' && summary"
      role="group"
      :aria-label="t('audit.securityGroups.label')"
      class="-mt-1 flex flex-wrap gap-1.5 max-md:-mx-4 max-md:flex-nowrap max-md:overflow-x-auto max-md:px-4"
    >
      <button
        type="button"
        class="inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :class="!securityGroup ? 'border-primary/50 bg-primary/8 text-primary' : 'border-border bg-card text-foreground hover:bg-accent'"
        :aria-pressed="!securityGroup"
        @click="showAllSecurity"
      >
        {{ t('audit.securityGroups.all') }}
        <span class="rounded-xs px-1 text-xs tabular-nums" :class="!securityGroup ? 'bg-primary/15' : 'bg-foreground/8 text-muted-foreground'">{{
          formatNumber(summary.kinds.security)
        }}</span>
      </button>
      <button
        v-for="chip in securityChips"
        :key="chip.group"
        type="button"
        class="inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :class="
          securityGroup === chip.group ? 'border-primary/50 bg-primary/8 text-primary' : 'border-border bg-card text-foreground hover:bg-accent'
        "
        :aria-pressed="securityGroup === chip.group"
        @click="selectGroup(chip.group)"
      >
        <TriangleAlert v-if="chip.group === 'failed'" :size="13" class="text-[var(--pill-warning)]" aria-hidden="true" />
        {{ t(`audit.securityGroups.${chip.group}`) }}
        <span
          class="rounded-xs px-1 text-xs tabular-nums"
          :class="securityGroup === chip.group ? 'bg-primary/15' : 'bg-foreground/8 text-muted-foreground'"
          >{{ formatNumber(chip.count) }}</span
        >
      </button>
    </div>

    <p v-if="error" role="alert" class="settings-error-state">{{ error }}</p>
    <p v-else-if="!loaded" role="status" class="settings-loading-state">{{ t('common.loading') }}</p>
    <div v-else-if="rowCount === 0" class="settings-empty-state text-sm text-muted-foreground">
      {{ hasFilters ? t('audit.emptyFiltered') : t('audit.empty') }}
    </div>
    <div v-else :aria-busy="loading">
      <AuditSignInTable v-if="view === 'signins'" :groups="signIns" />
      <template v-else>
        <AuditLedgerTable :sets="sets" :open-id="openSet?.id ?? null" :unit="unit" @open="openEvent" />
        <AuditLedgerList :sets="sets" @open="openEvent" />
      </template>
    </div>

    <div v-if="loaded && listTotal > 0" class="-mt-1 flex items-center justify-between gap-3 text-sm text-muted-foreground max-md:text-[13px]">
      <span class="tabular-nums">{{ pagerText }}</span>
      <nav v-if="totalPages > 1" :aria-label="t('audit.pager.label')" class="flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" type="button" :disabled="page <= 1" :aria-label="t('audit.pager.previous')" @click="previousPage">
          <ChevronLeft :size="16" class="rtl:rotate-180" aria-hidden="true" />
        </Button>
        <button
          v-for="number in pageNumbers"
          :key="number"
          type="button"
          class="inline-grid h-8 min-w-8 place-items-center rounded-md px-2 text-sm font-medium tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="[
            number === page
              ? 'border border-border bg-card text-foreground shadow-xs'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            number !== page ? 'max-md:hidden' : '',
          ]"
          :aria-current="number === page ? 'page' : undefined"
          :aria-label="t('audit.pager.page', { page: number })"
          @click="goToPage(number)"
        >
          {{ formatNumber(number) }}
        </button>
        <Button variant="ghost" size="icon-sm" type="button" :disabled="page >= totalPages" :aria-label="t('audit.pager.next')" @click="nextPage">
          <ChevronRight :size="16" class="rtl:rotate-180" aria-hidden="true" />
        </Button>
      </nav>
    </div>

    <AuditEventSheet
      :set="openSet"
      :load-around="audit.fetchAround"
      :load-history="audit.fetchHistory"
      @close="closeEvent"
      @select="selectEntry"
      @only-person="onlyPerson"
      @only-target="onlyTarget"
      @only-ip="onlyIp"
    />
  </div>
</template>
