<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, Image, Loader2, Pencil, RotateCw, Search, Trash2, Upload, UploadCloud, X } from '@lucide/vue'
import {
  CUSTOM_ICON_DEFAULT_PAGE_SIZE,
  CUSTOM_ICON_NAME_MAX_LENGTH,
  Permission,
  customIconValue,
  type CustomIcon,
  type CustomIconSort,
  type CustomIconUsage,
} from '@bookorbit/types'
import { toast } from 'vue-sonner'
import AppIcon from '@/components/AppIcon.vue'
import { Button } from '@/components/ui/button'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useCustomIcons } from '@/features/custom-icons/composables/useCustomIcons'
import IconUploadDialog from '@/features/custom-icons/components/IconUploadDialog.vue'

const { hasPermission } = usePermissions()
const { fetchIconPage, fetchIconUsage, updateCustomIcon, replaceCustomIconSvg, deleteCustomIcon, bulkDeleteCustomIcons } = useCustomIcons()

const canManageIcons = computed(() => hasPermission(Permission.ManageIcons))

const TILE_MIN_WIDTH = 68

const items = ref<CustomIcon[]>([])
const total = ref(0)
const page = ref(0)
const size = ref(CUSTOM_ICON_DEFAULT_PAGE_SIZE)
const sort = ref<CustomIconSort>('newest')
const query = ref('')
const loading = ref(false)
const error = ref<string | null>(null)

const uploadOpen = ref(false)
const selected = ref<Set<string>>(new Set())
const expandedSlug = ref<string | null>(null)
const usageBySlug = ref<Record<string, CustomIconUsage>>({})
const usageLoading = ref<string | null>(null)

const editingSlug = ref<string | null>(null)
const editingName = ref('')
const savingSlug = ref<string | null>(null)
const deletingSlug = ref<string | null>(null)
const replacingSlug = ref<string | null>(null)
const bulkDeleting = ref(false)

const gridRef = ref<HTMLElement | null>(null)
const columns = ref(6)
const replaceInputRef = ref<HTMLInputElement | null>(null)

let resizeObserver: ResizeObserver | null = null
let searchTimer: ReturnType<typeof setTimeout> | null = null

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / size.value)))
const selectedCount = computed(() => selected.value.size)
const expandedIcon = computed(() => items.value.find((icon) => icon.slug === expandedSlug.value) ?? null)
const expandedUsage = computed<CustomIconUsage | null>(() => (expandedSlug.value ? (usageBySlug.value[expandedSlug.value] ?? null) : null))
const expandedRowEnd = computed(() => {
  if (!expandedSlug.value) return -1
  const index = items.value.findIndex((icon) => icon.slug === expandedSlug.value)
  if (index === -1) return -1
  const cols = Math.max(1, columns.value)
  return Math.min(items.value.length - 1, Math.floor(index / cols) * cols + cols - 1)
})

const pageNumbers = computed(() => {
  const last = totalPages.value
  const current = page.value + 1
  const pages = new Set<number>([1, last, current, current - 1, current + 1])
  const sorted = [...pages].filter((p) => p >= 1 && p <= last).sort((a, b) => a - b)
  return sorted.map((p, idx) => ({ p, gapBefore: idx > 0 && p - sorted[idx - 1]! > 1 }))
})

const gridStyle = computed(() => ({ gridTemplateColumns: `repeat(${columns.value}, minmax(0, 1fr))` }))

async function loadPage() {
  loading.value = true
  error.value = null
  try {
    const result = await fetchIconPage({ q: query.value.trim() || undefined, sort: sort.value, page: page.value, size: size.value })
    if (page.value > 0 && result.items.length === 0 && result.total > 0) {
      page.value = Math.max(0, Math.ceil(result.total / size.value) - 1)
      await loadPage()
      return
    }
    items.value = result.items
    total.value = result.total
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load icons'
  } finally {
    loading.value = false
  }
}

function resetAndLoad() {
  page.value = 0
  expandedSlug.value = null
  selected.value = new Set()
  void loadPage()
}

onMounted(() => {
  measureColumns()
  if (gridRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(measureColumns)
    resizeObserver.observe(gridRef.value)
  }
  void loadPage()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  if (searchTimer) clearTimeout(searchTimer)
})

function measureColumns() {
  const width = gridRef.value?.clientWidth ?? 0
  if (width > 0) columns.value = Math.max(2, Math.min(10, Math.floor(width / TILE_MIN_WIDTH)))
}

watch(query, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(resetAndLoad, 300)
})

function setSort(value: CustomIconSort) {
  if (sort.value === value) return
  sort.value = value
  resetAndLoad()
}

function clearQuery() {
  query.value = ''
}

function openUpload() {
  uploadOpen.value = true
}

function goToPage(target: number) {
  const next = Math.min(totalPages.value, Math.max(1, target)) - 1
  if (next === page.value) return
  page.value = next
  expandedSlug.value = null
  void loadPage()
}

function goPrevPage() {
  goToPage(page.value)
}

function goNextPage() {
  goToPage(page.value + 2)
}

function refresh() {
  expandedSlug.value = null
  void loadPage()
}

function toggleSelect(slug: string) {
  const next = new Set(selected.value)
  if (next.has(slug)) next.delete(slug)
  else next.add(slug)
  selected.value = next
}

function clearSelection() {
  selected.value = new Set()
}

function collapseExpanded() {
  expandedSlug.value = null
}

async function toggleExpand(icon: CustomIcon) {
  if (expandedSlug.value === icon.slug) {
    expandedSlug.value = null
    return
  }
  cancelEdit()
  expandedSlug.value = icon.slug
  if (!usageBySlug.value[icon.slug]) await loadUsage(icon.slug)
}

async function loadUsage(slug: string) {
  usageLoading.value = slug
  try {
    usageBySlug.value = { ...usageBySlug.value, [slug]: await fetchIconUsage(slug) }
  } catch {
    // usage is best-effort; leave undefined
  } finally {
    if (usageLoading.value === slug) usageLoading.value = null
  }
}

function startEdit(icon: CustomIcon) {
  editingSlug.value = icon.slug
  editingName.value = icon.name
}

function cancelEdit() {
  editingSlug.value = null
  editingName.value = ''
}

async function saveEdit(icon: CustomIcon) {
  const name = editingName.value.trim()
  if (!name || savingSlug.value) return
  savingSlug.value = icon.slug
  try {
    await updateCustomIcon(icon.slug, { name })
    cancelEdit()
    toast.success('Icon saved')
    await loadPage()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to save icon')
  } finally {
    savingSlug.value = null
  }
}

function openReplaceFilePicker(icon: CustomIcon) {
  replacingSlug.value = icon.slug
  replaceInputRef.value?.click()
}

async function handleReplaceInput(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  const slug = replacingSlug.value
  input.value = ''
  replacingSlug.value = null
  if (!file || !slug) return
  try {
    await replaceCustomIconSvg(slug, file)
    toast.success('Icon updated')
    await loadPage()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to replace icon')
  }
}

async function removeIcon(icon: CustomIcon) {
  if (deletingSlug.value) return
  if (!window.confirm(`Delete "${icon.name}"? Existing uses will fall back to their default icon.`)) return
  deletingSlug.value = icon.slug
  try {
    await deleteCustomIcon(icon.slug)
    if (expandedSlug.value === icon.slug) expandedSlug.value = null
    const next = new Set(selected.value)
    next.delete(icon.slug)
    selected.value = next
    toast.success('Icon deleted')
    await loadPage()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to delete icon')
  } finally {
    deletingSlug.value = null
  }
}

async function deleteSelected() {
  if (bulkDeleting.value || selected.value.size === 0) return
  const slugs = [...selected.value]
  if (!window.confirm(`Delete ${slugs.length} icon${slugs.length === 1 ? '' : 's'}? Existing uses will fall back to their default icon.`)) return
  bulkDeleting.value = true
  try {
    const result = await bulkDeleteCustomIcons(slugs)
    clearSelection()
    expandedSlug.value = null
    if (result.failed.length > 0) toast.warning(`Deleted ${result.deleted.length}, ${result.failed.length} failed`)
    else toast.success(`Deleted ${result.deleted.length} icon${result.deleted.length === 1 ? '' : 's'}`)
    await loadPage()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to delete icons')
  } finally {
    bulkDeleting.value = false
  }
}

function handleUploaded() {
  resetAndLoad()
}

function usageSummary(usage: CustomIconUsage): string {
  const parts: string[] = []
  if (usage.libraries) parts.push(`${usage.libraries} librar${usage.libraries === 1 ? 'y' : 'ies'}`)
  if (usage.collections) parts.push(`${usage.collections} collection${usage.collections === 1 ? '' : 's'}`)
  if (usage.smartScopes) parts.push(`${usage.smartScopes} smart scope${usage.smartScopes === 1 ? '' : 's'}`)
  return parts.join(', ')
}
</script>

<template>
  <div class="space-y-5">
    <input ref="replaceInputRef" type="file" accept="image/svg+xml,.svg" class="hidden" @change="handleReplaceInput" />
    <IconUploadDialog v-if="canManageIcons" v-model:open="uploadOpen" @uploaded="handleUploaded" />

    <section class="space-y-3">
      <div class="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button v-if="canManageIcons" type="button" class="h-9 gap-2 self-start sm:self-auto" @click="openUpload">
          <UploadCloud :size="15" />
          Upload icons
        </Button>
        <div class="sm:text-right">
          <p class="settings-group-label mb-0">Custom Icons</p>
          <p class="text-xs text-muted-foreground">{{ total }} icon{{ total === 1 ? '' : 's' }} uploaded</p>
        </div>
      </div>

      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-background px-3 sm:max-w-xs">
          <Search :size="14" class="shrink-0 text-muted-foreground" />
          <input
            v-model="query"
            type="text"
            placeholder="Search icons"
            class="w-full min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
          />
          <button v-if="query" type="button" class="shrink-0 text-muted-foreground hover:text-foreground" @click="clearQuery">
            <X :size="13" />
          </button>
        </div>

        <div class="flex items-center gap-2">
          <div class="flex h-9 items-center rounded-md border border-input bg-background p-0.5 text-xs">
            <button
              type="button"
              class="h-8 rounded px-2.5 font-medium transition-colors"
              :class="sort === 'newest' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="setSort('newest')"
            >
              Newest
            </button>
            <button
              type="button"
              class="h-8 rounded px-2.5 font-medium transition-colors"
              :class="sort === 'name' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="setSort('name')"
            >
              Name
            </button>
          </div>
          <Button type="button" variant="outline" size="icon" class="h-9 w-9 shrink-0" :disabled="loading" @click="refresh">
            <RotateCw :size="14" :class="loading ? 'animate-spin' : ''" />
          </Button>
        </div>
      </div>

      <div
        v-if="canManageIcons && selectedCount > 0"
        class="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm"
      >
        <span class="font-medium text-foreground">{{ selectedCount }} selected</span>
        <div class="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" class="h-8" @click="clearSelection">Clear</Button>
          <Button type="button" variant="destructive" size="sm" class="h-8 gap-1.5" :disabled="bulkDeleting" @click="deleteSelected">
            <Loader2 v-if="bulkDeleting" :size="14" class="animate-spin" />
            <Trash2 v-else :size="14" />
            Delete selected
          </Button>
        </div>
      </div>

      <div v-if="error" class="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        {{ error }}
      </div>

      <div
        v-else-if="loading && items.length === 0"
        class="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground"
      >
        <Loader2 :size="20" class="mx-auto mb-2 animate-spin" />
        Loading icons...
      </div>

      <div v-else-if="items.length === 0" class="rounded-lg border border-border bg-card px-4 py-10 text-center">
        <Image :size="22" class="mx-auto mb-2 text-muted-foreground" />
        <p class="text-sm text-muted-foreground">{{ query ? 'No icons match your search.' : 'No custom icons uploaded yet.' }}</p>
      </div>

      <div v-else>
        <div ref="gridRef" class="grid gap-2" :style="gridStyle">
          <template v-for="(icon, index) in items" :key="icon.slug">
            <div
              class="group relative flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border p-2.5 text-center transition-colors"
              :class="[
                expandedSlug === icon.slug ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary/40',
                selected.has(icon.slug) ? 'ring-1 ring-primary' : '',
              ]"
              @click="toggleExpand(icon)"
            >
              <button
                v-if="canManageIcons"
                type="button"
                class="absolute left-1.5 top-1.5 flex size-5 items-center justify-center rounded border bg-background/90 transition-opacity"
                :class="
                  selected.has(icon.slug)
                    ? 'border-primary bg-primary text-primary-foreground opacity-100'
                    : 'border-input opacity-0 group-hover:opacity-100'
                "
                @click.stop="toggleSelect(icon.slug)"
              >
                <svg v-if="selected.has(icon.slug)" viewBox="0 0 24 24" class="size-3.5" fill="none" stroke="currentColor" stroke-width="3">
                  <path d="M5 12l5 5L20 7" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>

              <div class="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <AppIcon :icon="customIconValue(icon.slug)" :size="22" />
              </div>
              <span class="w-full truncate text-xs text-foreground" :title="icon.name">{{ icon.name }}</span>
            </div>

            <div v-if="index === expandedRowEnd && expandedIcon" class="col-span-full" style="grid-column: 1 / -1">
              <div class="rounded-lg border border-primary/30 bg-card p-4 shadow-xs">
                <div class="flex items-start gap-4">
                  <div class="flex size-16 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <AppIcon :icon="customIconValue(expandedIcon.slug)" :size="36" />
                  </div>

                  <div class="min-w-0 flex-1">
                    <template v-if="editingSlug === expandedIcon.slug">
                      <div class="grid max-w-md gap-2">
                        <input
                          v-model="editingName"
                          :maxlength="CUSTOM_ICON_NAME_MAX_LENGTH"
                          placeholder="Name"
                          class="h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                      </div>
                    </template>
                    <template v-else>
                      <p class="truncate text-sm font-semibold text-foreground">{{ expandedIcon.name }}</p>
                      <p class="mt-1 text-xs text-muted-foreground">
                        <span v-if="usageLoading === expandedIcon.slug">Checking usage...</span>
                        <template v-else-if="expandedUsage">
                          <template v-if="expandedUsage.total > 0">
                            Used by {{ expandedUsage.total }}
                            <span class="text-muted-foreground/70">({{ usageSummary(expandedUsage) }})</span>
                          </template>
                          <template v-else>Not used yet</template>
                        </template>
                      </p>
                    </template>
                  </div>

                  <button
                    type="button"
                    class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    @click="collapseExpanded"
                  >
                    <X :size="15" />
                  </button>
                </div>

                <div v-if="canManageIcons" class="mt-3 flex flex-wrap justify-end gap-2">
                  <template v-if="editingSlug === expandedIcon.slug">
                    <Button type="button" size="sm" class="h-8" :disabled="savingSlug === expandedIcon.slug" @click="saveEdit(expandedIcon)">
                      <Loader2 v-if="savingSlug === expandedIcon.slug" :size="14" class="animate-spin" />
                      Save
                    </Button>
                    <Button type="button" variant="outline" size="sm" class="h-8" @click="cancelEdit">Cancel</Button>
                  </template>
                  <template v-else>
                    <Button type="button" variant="outline" size="sm" class="h-8 gap-1.5" @click="startEdit(expandedIcon)">
                      <Pencil :size="14" />
                      Rename
                    </Button>
                    <Button type="button" variant="outline" size="sm" class="h-8 gap-1.5" @click="openReplaceFilePicker(expandedIcon)">
                      <Upload :size="14" />
                      Replace
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      class="h-8 gap-1.5 text-destructive hover:border-destructive/40 hover:bg-destructive/5"
                      :disabled="deletingSlug === expandedIcon.slug"
                      @click="removeIcon(expandedIcon)"
                    >
                      <Loader2 v-if="deletingSlug === expandedIcon.slug" :size="14" class="animate-spin" />
                      <Trash2 v-else :size="14" />
                      Delete
                    </Button>
                  </template>
                </div>
              </div>
            </div>
          </template>
        </div>

        <div v-if="totalPages > 1" class="mt-4 flex items-center justify-center gap-1">
          <Button type="button" variant="outline" size="icon" class="h-8 w-8" :disabled="page === 0 || loading" @click="goPrevPage">
            <ChevronLeft :size="15" />
          </Button>
          <template v-for="item in pageNumbers" :key="item.p">
            <span v-if="item.gapBefore" class="px-1 text-sm text-muted-foreground">...</span>
            <Button
              type="button"
              :variant="item.p - 1 === page ? 'default' : 'outline'"
              size="icon"
              class="h-8 w-8 text-sm"
              :disabled="loading"
              @click="goToPage(item.p)"
            >
              {{ item.p }}
            </Button>
          </template>
          <Button type="button" variant="outline" size="icon" class="h-8 w-8" :disabled="page + 1 >= totalPages || loading" @click="goNextPage">
            <ChevronRight :size="15" />
          </Button>
        </div>
      </div>
    </section>
  </div>
</template>
