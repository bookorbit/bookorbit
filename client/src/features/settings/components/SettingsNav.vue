<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ChevronRight, Search, X } from '@lucide/vue'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useSettingsNavStatus } from '../composables/useSettingsNavStatus'
import { visibleSettingsNav, type SettingsNavGroup, type SettingsNavItem } from '../lib/settings-nav'
interface SearchHit {
  item: SettingsNavItem
  group: SettingsNavGroup
  rank: number
}

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { isSuperuser, userPermissions, isDemoRestrictedAccount } = usePermissions()

const query = ref('')
const searchInput = ref<HTMLInputElement | null>(null)

const groups = computed(() =>
  visibleSettingsNav({
    isSuperuser: isSuperuser.value,
    permissions: userPermissions.value,
    isDemoRestricted: isDemoRestrictedAccount.value,
  }),
)

const showsLibraryScan = computed(() => groups.value.some((group) => group.items.some((item) => item.status === 'libraryScan')))
const { isLibraryScanning } = useSettingsNavStatus(showsLibraryScan)

const activeRouteName = computed(() => (typeof route.name === 'string' ? route.name : ''))

function isActive(item: SettingsNavItem): boolean {
  return item.routeName === activeRouteName.value
}

function isBranchActive(item: SettingsNavItem): boolean {
  if (isActive(item)) return true
  return item.children?.some(isActive) ?? false
}

/**
 * Which branch is open. `null` follows the route, so a deep link or a reload lands with the
 * relevant branch already expanded; a string pins one open and `''` closes them all. Toggling
 * writes here, and navigating hands control back to the route.
 */
const openBranch = ref<string | null>(null)

watch(activeRouteName, () => {
  openBranch.value = null
})

function isBranchOpen(item: SettingsNavItem): boolean {
  if (!item.children?.length) return false
  return openBranch.value === null ? isBranchActive(item) : openBranch.value === item.id
}

/** A parent row opens its first child, since parents are groupings rather than pages. */
function branchTarget(item: SettingsNavItem): string {
  return item.children?.[0]?.routeName ?? item.routeName
}

/** Opening a grouping row jumps to its first page; closing it leaves you where you are. */
function toggleBranch(item: SettingsNavItem): void {
  if (isBranchOpen(item)) {
    openBranch.value = ''
    return
  }
  openBranch.value = item.id
  const target = branchTarget(item)
  if (target !== activeRouteName.value) void router.push({ name: target })
}

/** A grouping row is a disclosure, not a destination, so it must not render as a link. */
function rowTag(item: SettingsNavItem): string {
  return item.children?.length ? 'button' : 'RouterLink'
}

function rowProps(item: SettingsNavItem): Record<string, unknown> {
  if (item.children?.length) return { type: 'button', 'aria-expanded': isBranchOpen(item) }
  return { to: { name: item.routeName }, 'aria-current': isActive(item) ? 'page' : undefined }
}

function handleRowClick(item: SettingsNavItem): void {
  if (item.children?.length) toggleBranch(item)
}

function searchText(item: SettingsNavItem, group: SettingsNavGroup): string {
  const description = item.descriptionKey ? t(item.descriptionKey) : ''
  return `${t(item.labelKey)} ${description} ${item.keywords ?? ''} ${t(group.labelKey)}`.toLowerCase()
}

/** Leaf destinations only: a parent with children is never a navigation target on its own. */
const searchableItems = computed<{ item: SettingsNavItem; group: SettingsNavGroup }[]>(() =>
  groups.value.flatMap((group) =>
    group.items.flatMap((item) => (item.children?.length ? item.children.map((child) => ({ item: child, group })) : [{ item, group }])),
  ),
)

const results = computed<SearchHit[]>(() => {
  const terms = query.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  return searchableItems.value
    .map(({ item, group }) => {
      const haystack = searchText(item, group)
      if (!terms.every((term) => haystack.includes(term))) return null
      const label = t(item.labelKey).toLowerCase()
      const lead = terms[0] ?? ''
      const rank = label.startsWith(lead) ? 0 : label.includes(lead) ? 1 : 2
      return { item, group, rank }
    })
    .filter((hit): hit is SearchHit => hit !== null)
    .sort((a, b) => a.rank - b.rank)
})

const isSearching = computed(() => query.value.trim().length > 0)

function clearSearch(): void {
  query.value = ''
  searchInput.value?.focus()
}

function focusSearch(): void {
  searchInput.value?.focus()
  searchInput.value?.select()
}

function handleShortcut(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    focusSearch()
  }
}

function handleSearchKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') clearSearch()
}

onMounted(() => window.addEventListener('keydown', handleShortcut))
onBeforeUnmount(() => window.removeEventListener('keydown', handleShortcut))

defineExpose({ focusSearch })
</script>

<template>
  <nav class="flex h-full min-h-0 flex-col" :aria-label="t('settings.nav.ariaLabel')">
    <div class="flex shrink-0 items-center gap-1.5 border-b border-border/70 px-3 py-3">
      <RouterLink
        to="/"
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-hidden transition-colors duration-150 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        :title="t('settings.nav.backToApp')"
        :aria-label="t('settings.nav.backToApp')"
        data-testid="settings-nav-back"
      >
        <ArrowLeft :size="16" aria-hidden="true" />
      </RouterLink>

      <div class="relative min-w-0 flex-1">
        <Search :size="15" class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          ref="searchInput"
          v-model="query"
          type="search"
          class="h-9 w-full min-w-0 rounded-md border border-input bg-background pl-8 pr-8 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          :placeholder="t('settings.nav.searchPlaceholder')"
          :aria-label="t('settings.nav.searchPlaceholder')"
          data-testid="settings-nav-search"
          @keydown="handleSearchKeydown"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          v-if="isSearching"
          type="button"
          class="absolute right-2 top-1/2 -translate-y-1/2"
          :aria-label="t('settings.nav.clearSearch')"
          @click="clearSearch"
        >
          <X :size="14" aria-hidden="true" />
        </Button>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
      <template v-if="isSearching">
        <p v-if="results.length === 0" class="px-3 py-6 text-center text-sm text-muted-foreground">
          {{ t('settings.nav.noResults', { query: query.trim() }) }}
        </p>
        <RouterLink
          v-for="hit in results"
          :key="`${hit.group.id}-${hit.item.id}`"
          :to="{ name: hit.item.routeName }"
          class="group flex items-start gap-2.5 rounded-md px-2.5 py-2 text-left outline-hidden transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          :class="isActive(hit.item) ? 'bg-sidebar-accent' : ''"
          :aria-current="isActive(hit.item) ? 'page' : undefined"
          data-testid="settings-nav-result"
        >
          <component
            :is="hit.item.icon"
            :size="15"
            class="mt-0.5 shrink-0 transition-colors"
            :class="isActive(hit.item) ? 'text-sidebar-accent-foreground' : 'text-muted-foreground group-hover:text-sidebar-accent-foreground'"
            aria-hidden="true"
          />
          <span class="min-w-0 flex-1">
            <span
              class="block truncate text-sm transition-colors group-hover:text-sidebar-accent-foreground"
              :class="isActive(hit.item) ? 'font-medium text-sidebar-accent-foreground' : 'font-normal text-sidebar-foreground'"
              data-testid="settings-nav-result-label"
            >
              {{ t(hit.item.labelKey) }}
            </span>
            <span class="block truncate text-[11.5px] text-muted-foreground">{{ t(hit.group.labelKey) }}</span>
          </span>
        </RouterLink>
      </template>

      <template v-else>
        <div v-for="group in groups" :key="group.id" class="mb-3 last:mb-1">
          <div class="flex items-center gap-2 px-2.5 pb-1.5 pt-2">
            <span class="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground" data-testid="settings-nav-group">{{
              t(group.labelKey)
            }}</span>
            <span class="h-px flex-1 bg-border/70"></span>
          </div>

          <template v-for="item in group.items" :key="item.id">
            <component
              :is="rowTag(item)"
              v-bind="rowProps(item)"
              class="group relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm outline-hidden transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              :class="
                isBranchActive(item)
                  ? 'bg-sidebar-accent font-medium before:absolute before:-left-2 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-sidebar-primary'
                  : 'font-normal'
              "
              data-testid="settings-nav-item"
              @click="handleRowClick(item)"
            >
              <component
                :is="item.icon"
                :size="15"
                class="shrink-0 transition-colors"
                :class="isBranchActive(item) ? 'text-sidebar-accent-foreground' : 'text-muted-foreground group-hover:text-sidebar-accent-foreground'"
                aria-hidden="true"
                data-testid="settings-nav-item-icon"
              />
              <span
                class="min-w-0 flex-1 truncate transition-colors group-hover:text-sidebar-accent-foreground"
                :class="isBranchActive(item) ? 'text-sidebar-accent-foreground' : 'text-sidebar-foreground'"
                data-testid="settings-nav-item-label"
              >
                {{ t(item.labelKey) }}
              </span>

              <span
                v-if="item.status === 'libraryScan' && isLibraryScanning"
                role="status"
                class="shrink-0 rounded-full bg-primary/15 px-1.5 py-px text-[10.5px] font-medium text-primary"
                data-testid="settings-nav-item-status"
              >
                {{ t('settings.nav.status.scanning') }}
              </span>

              <ChevronRight
                v-if="item.children?.length"
                :size="13"
                class="shrink-0 text-muted-foreground motion-safe:transition-transform motion-safe:duration-150"
                :class="isBranchOpen(item) ? 'rotate-90' : ''"
                aria-hidden="true"
                data-testid="settings-nav-item-chevron"
              />
            </component>

            <div v-if="isBranchOpen(item)" class="ml-4 mt-0.5 mb-1 border-l border-border/70 pl-2">
              <RouterLink
                v-for="child in item.children"
                :key="child.id"
                :to="{ name: child.routeName }"
                class="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] outline-hidden transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                :class="isActive(child) ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground' : 'font-normal text-sidebar-foreground'"
                :aria-current="isActive(child) ? 'page' : undefined"
                data-testid="settings-nav-child"
              >
                <span class="truncate">{{ t(child.labelKey) }}</span>
              </RouterLink>
            </div>
          </template>
        </div>
      </template>
    </div>

    <div class="hidden shrink-0 border-t border-border/70 px-4 py-2 text-[11px] text-muted-foreground md:block">
      {{ t('settings.nav.shortcutHint') }}
    </div>
  </nav>
</template>
