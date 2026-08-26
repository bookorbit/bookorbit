<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMediaQuery } from '@vueuse/core'
import {
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Library as LibraryIcon,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
  UserRound,
  X,
  type LucideIcon,
} from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import Badge from '@/components/ui/badge/Badge.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { formatDate, formatDateTime, formatNumber } from '@/i18n/formatters'
import StatusPill from './components/StatusPill.vue'
import UserPermissionsSection from './components/UserPermissionsSection.vue'
import UserRestrictionsSection from './components/UserRestrictionsSection.vue'
import { useUserForm, type UserFormSection, type UserFormTarget } from './composables/useUserForm'

interface LibraryOption {
  id: number
  name: string
  bookCount?: number
}

const props = defineProps<{
  user: UserFormTarget | null
  libraries: LibraryOption[]
  defaultLibraryIds?: number[]
  canDelete?: boolean
}>()

const emit = defineEmits<{
  close: []
  saved: [resetUrl?: string]
  delete: []
}>()

const { t } = useI18n()

const {
  name,
  username,
  email,
  active,
  isSharedAccount,
  selectedPermissionNames,
  selectedLibraryIds,
  includeTagItems,
  excludeTagItems,
  includeGenreItems,
  excludeGenreItems,
  seeOwnRequestedBooks,
  contentFiltersEnabled,
  loading,
  error,
  errorKey,
  isEdit,
  isSuperuserTarget,
  grantedCount,
  totalPermissions,
  restrictionState,
  changeCount,
  toggleLibrary,
  setLibraries,
  togglePermission,
  applyPreset,
  setContentFiltersEnabled,
  save,
} = useUserForm(toRef(props, 'user'), toRef(props, 'defaultLibraryIds'))

/** Below this the sheet is too narrow to carry the rail, so sections become a drill-in list. */
const isWide = useMediaQuery('(min-width: 768px)')
const isNarrowViewport = useMediaQuery('(max-width: 639px)')

const open = ref(true)
const activeSection = ref<UserFormSection | null>(null)

const side = computed(() => (isNarrowViewport.value ? ('bottom' as const) : ('right' as const)))
const sizeClass = computed(() => (isNarrowViewport.value ? 'h-full rounded-none' : 'w-full sm:max-w-[52.5rem]'))

const showSectionMenu = computed(() => !isWide.value && activeSection.value === null)
const showBackButton = computed(() => !isWide.value && activeSection.value !== null)

const headerTitle = computed(() => {
  if (isEdit.value) return name.value || username.value || t('adminFeature.userForm.editUser')
  return isSharedAccount.value ? t('adminFeature.userForm.createSharedAccount') : t('adminFeature.userForm.createUser')
})

const avatarInitial = computed(() => (name.value || username.value || '?').trim().charAt(0).toUpperCase())

const signInMethod = computed(() => {
  const method = props.user?.provisioningMethod ?? 'local'
  if (method === 'oidc') return t('adminFeature.userForm.signInMethods.oidc')
  if (method === 'shared') return t('adminFeature.userForm.signInMethods.shared')
  return t('adminFeature.userForm.signInMethods.password')
})

const createdLabel = computed(() => (props.user?.createdAt ? formatDate(new Date(props.user.createdAt), { dateStyle: 'medium' }) : null))

const lockedUntil = computed(() => {
  const value = props.user?.lockedUntil
  if (!value) return null
  const until = new Date(value)
  return until.getTime() > Date.now() ? until : null
})

const restrictionSummary = computed(() => {
  switch (restrictionState.value) {
    case 'both':
      return t('adminFeature.userForm.sectionSummary.restrictionsBoth')
    case 'content':
      return t('adminFeature.userForm.sectionSummary.restrictionsContent')
    case 'demo':
      return t('adminFeature.userForm.sectionSummary.restrictionsDemo')
    default:
      return t('adminFeature.userForm.sectionSummary.restrictionsNone')
  }
})

const profileSummary = computed(() => {
  if (!isEdit.value) return t('adminFeature.userForm.sectionSummary.newAccount')
  if (lockedUntil.value) return t('adminFeature.usersPage.lockedBadge')
  return active.value ? t('adminFeature.userForm.active') : t('adminFeature.userForm.suspended')
})

interface SectionEntry {
  id: UserFormSection
  label: string
  summary: string
  icon: LucideIcon
}

const sections = computed<SectionEntry[]>(() => [
  { id: 'profile', label: t('adminFeature.userForm.sections.profile'), summary: profileSummary.value, icon: UserRound },
  {
    id: 'libraries',
    label: t('adminFeature.userForm.sections.libraries'),
    summary: t('adminFeature.userForm.sectionSummary.libraries', {
      selected: formatNumber(selectedLibraryIds.value.size),
      total: formatNumber(props.libraries.length),
    }),
    icon: LibraryIcon,
  },
  {
    id: 'permissions',
    label: t('adminFeature.userForm.sections.permissions'),
    summary: t('adminFeature.userForm.sectionSummary.permissions', { count: grantedCount.value }),
    icon: KeyRound,
  },
  { id: 'restrictions', label: t('adminFeature.userForm.sections.restrictions'), summary: restrictionSummary.value, icon: SlidersHorizontal },
])

const activeSectionLabel = computed(() => sections.value.find((section) => section.id === activeSection.value)?.label ?? '')

const allLibrariesSelected = computed(() => props.libraries.length > 0 && selectedLibraryIds.value.size === props.libraries.length)

const libraryReach = computed(() => {
  const counted = props.libraries.filter((library) => library.bookCount !== undefined)
  if (counted.length === 0) return null
  const total = counted.reduce((sum, library) => sum + (library.bookCount ?? 0), 0)
  const selected = counted.filter((library) => selectedLibraryIds.value.has(library.id)).reduce((sum, library) => sum + (library.bookCount ?? 0), 0)
  return { selected: formatNumber(selected), total: formatNumber(total) }
})

const errorMessage = computed(() => {
  if (error.value) return error.value
  if (!errorKey.value) return null
  return t(`adminFeature.userForm.errors.${errorKey.value}`)
})

watch(
  isWide,
  (wide) => {
    if (wide && activeSection.value === null) activeSection.value = 'profile'
  },
  { immediate: true },
)

watch(
  () => props.user,
  () => {
    activeSection.value = isWide.value ? 'profile' : null
  },
)

function selectSection(section: UserFormSection) {
  activeSection.value = section
}

function backToSections() {
  activeSection.value = null
}

function handleOpenChange(value: boolean) {
  if (!value) emit('close')
}

function handleClose() {
  open.value = false
  emit('close')
}

function handleDelete() {
  emit('delete')
}

function toggleAllLibraries() {
  setLibraries(allLibrariesSelected.value ? [] : props.libraries.map((library) => library.id))
}

async function handleSubmit() {
  const result = await save()
  if (!result.ok) {
    if (result.section) activeSection.value = result.section
    return
  }
  emit('saved', result.resetUrl)
}
</script>

<template>
  <Sheet :open="open" @update:open="handleOpenChange">
    <SheetContent :side="side" hide-close class="gap-0 p-0" :class="sizeClass">
      <SheetTitle class="sr-only">{{ headerTitle }}</SheetTitle>
      <SheetDescription class="sr-only">{{ t('adminFeature.userForm.drawerDescription') }}</SheetDescription>

      <header class="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3 sm:px-5">
        <Button v-if="showBackButton" variant="ghost" size="icon-sm" type="button" :aria-label="t('common.back')" @click="backToSections">
          <ChevronLeft :size="18" aria-hidden="true" />
        </Button>
        <span
          v-else-if="isEdit"
          aria-hidden="true"
          class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary"
        >
          {{ avatarInitial }}
        </span>

        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <h2 class="truncate text-base font-semibold text-foreground">{{ showBackButton ? activeSectionLabel : headerTitle }}</h2>
            <StatusPill v-if="isEdit && !showBackButton" :tone="active ? 'success' : 'danger'" class="shrink-0">
              {{ active ? t('adminFeature.userForm.active') : t('adminFeature.userForm.suspended') }}
            </StatusPill>
            <Badge v-if="isSharedAccount && !showBackButton" variant="secondary" class="shrink-0">
              {{ t('adminFeature.userForm.sharedBadge') }}
            </Badge>
          </div>
          <p v-if="showBackButton" class="mt-0.5 truncate text-xs text-muted-foreground">{{ headerTitle }}</p>
          <p v-else-if="isEdit" class="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span class="truncate font-mono">@{{ username }}</span>
            <template v-if="email">
              <span aria-hidden="true">&middot;</span>
              <span class="truncate">{{ email }}</span>
            </template>
            <template v-if="isWide">
              <span aria-hidden="true">&middot;</span>
              <span class="shrink-0">{{ signInMethod }}</span>
            </template>
          </p>
          <p v-else class="mt-0.5 text-xs text-muted-foreground">{{ t('adminFeature.userForm.createHint') }}</p>
        </div>

        <Button variant="ghost" size="icon-sm" type="button" :aria-label="t('common.close')" @click="handleClose">
          <X :size="16" aria-hidden="true" />
        </Button>
      </header>

      <div class="flex min-h-0 flex-1">
        <nav v-if="isWide" :aria-label="t('adminFeature.userForm.sectionsLabel')" class="w-52 shrink-0 border-e border-border bg-card p-2.5">
          <ul class="space-y-0.5">
            <li v-for="section in sections" :key="section.id">
              <button
                type="button"
                class="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-start transition-colors"
                :class="activeSection === section.id ? 'bg-primary/10' : 'hover:bg-muted'"
                :aria-current="activeSection === section.id ? 'true' : undefined"
                @click="selectSection(section.id)"
              >
                <component
                  :is="section.icon"
                  :size="15"
                  class="mt-0.5 shrink-0"
                  :class="activeSection === section.id ? 'text-primary' : 'text-muted-foreground'"
                  aria-hidden="true"
                />
                <span class="min-w-0">
                  <span class="block truncate text-sm font-medium" :class="activeSection === section.id ? 'text-primary' : 'text-foreground'">
                    {{ section.label }}
                  </span>
                  <span class="mt-0.5 block truncate text-xs text-muted-foreground">{{ section.summary }}</span>
                </span>
              </button>
            </li>
          </ul>
        </nav>

        <div class="@container min-w-0 flex-1 overflow-y-auto p-4 sm:p-5">
          <ul v-if="showSectionMenu" class="space-y-2">
            <li v-for="section in sections" :key="section.id">
              <button
                type="button"
                class="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-3 text-start"
                @click="selectSection(section.id)"
              >
                <component :is="section.icon" :size="17" class="shrink-0 text-muted-foreground" aria-hidden="true" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium text-foreground">{{ section.label }}</span>
                  <span class="mt-0.5 block truncate text-xs text-muted-foreground">{{ section.summary }}</span>
                </span>
                <ChevronRight :size="16" class="shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            </li>
          </ul>

          <section v-else-if="activeSection === 'profile'" class="space-y-5">
            <label v-if="!isEdit" class="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
              <input v-model="isSharedAccount" type="checkbox" class="mt-0.5 size-4 shrink-0 rounded border-input accent-primary" />
              <span>
                <span class="block text-sm font-medium text-foreground">{{ t('adminFeature.userForm.sharedAccount') }}</span>
                <span class="settings-hint block">{{ t('adminFeature.userForm.sharedAccountHint') }}</span>
              </span>
            </label>

            <div class="grid gap-3 @lg:grid-cols-2">
              <div class="space-y-1.5">
                <label for="user-form-name" class="settings-label block">{{ t('adminFeature.userForm.fullName') }}</label>
                <input
                  id="user-form-name"
                  v-model="name"
                  type="text"
                  required
                  class="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div class="space-y-1.5">
                <label for="user-form-username" class="settings-label block">{{ t('adminFeature.userForm.username') }}</label>
                <input
                  id="user-form-username"
                  v-model="username"
                  type="text"
                  required
                  :readonly="isEdit"
                  class="h-9 w-full rounded-lg border border-input px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  :class="isEdit ? 'bg-muted text-muted-foreground' : 'bg-background text-foreground'"
                />
                <p v-if="isEdit" class="settings-hint">{{ t('adminFeature.userForm.usernameFixedHint') }}</p>
              </div>
            </div>

            <div class="space-y-1.5">
              <label for="user-form-email" class="settings-label block">
                {{ t('adminFeature.userForm.email') }}
                <span v-if="isSharedAccount && !isEdit" class="font-normal text-muted-foreground">{{ t('adminFeature.userForm.optional') }}</span>
              </label>
              <input
                id="user-form-email"
                v-model="email"
                type="email"
                :required="!isEdit && !isSharedAccount"
                class="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <p class="settings-hint">{{ t('adminFeature.userForm.emailHint') }}</p>
            </div>

            <div v-if="isEdit">
              <h3 class="settings-group-label">{{ t('adminFeature.userForm.account') }}</h3>
              <dl class="divide-y divide-border rounded-lg border border-border bg-card">
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                  <dt id="user-form-status" class="w-24 shrink-0 text-xs text-muted-foreground">{{ t('adminFeature.userForm.status') }}</dt>
                  <dd class="flex items-center gap-2.5">
                    <ToggleSwitch v-model="active" aria-labelledby="user-form-status" />
                    <span class="text-sm text-foreground">{{
                      active ? t('adminFeature.userForm.active') : t('adminFeature.userForm.suspended')
                    }}</span>
                  </dd>
                  <dd class="settings-hint w-full @lg:ms-auto @lg:mt-0 @lg:w-auto">{{ t('adminFeature.userForm.statusHint') }}</dd>
                </div>
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                  <dt class="w-24 shrink-0 text-xs text-muted-foreground">{{ t('adminFeature.userForm.signInMethod') }}</dt>
                  <dd class="text-sm text-foreground">{{ signInMethod }}</dd>
                </div>
                <div v-if="createdLabel" class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                  <dt class="w-24 shrink-0 text-xs text-muted-foreground">{{ t('adminFeature.userForm.created') }}</dt>
                  <dd class="text-sm text-foreground">{{ createdLabel }}</dd>
                </div>
                <div v-if="lockedUntil" class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                  <dt class="w-24 shrink-0 text-xs text-muted-foreground">{{ t('adminFeature.usersPage.lockedBadge') }}</dt>
                  <dd class="text-sm text-foreground">{{ t('adminFeature.userForm.lockedUntil', { time: formatDateTime(lockedUntil) }) }}</dd>
                  <dd class="settings-hint w-full @lg:ms-auto @lg:mt-0 @lg:w-auto">{{ t('adminFeature.userForm.lockedHint') }}</dd>
                </div>
              </dl>
            </div>

            <div v-else-if="isSharedAccount" class="flex gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
              <ShieldCheck :size="16" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <p class="settings-hint">{{ t('adminFeature.userForm.sharedAccountManageHint') }}</p>
            </div>

            <div v-if="isEdit && canDelete">
              <h3 class="settings-group-label">{{ t('adminFeature.userForm.dangerZone') }}</h3>
              <div class="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-card px-3 py-2.5">
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-foreground">{{ t('adminFeature.usersPage.deleteUserAction') }}</p>
                  <p class="settings-hint">{{ t('adminFeature.userForm.deleteUserHint') }}</p>
                </div>
                <Button variant="destructive-outline" size="sm" type="button" @click="handleDelete">{{ t('common.delete') }}</Button>
              </div>
            </div>
          </section>

          <section v-else-if="activeSection === 'libraries'" class="space-y-3">
            <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div class="min-w-0">
                <h3 class="settings-label">{{ t('adminFeature.userForm.libraryAccess') }}</h3>
                <p class="settings-hint">{{ t('adminFeature.userForm.libraryAccessHint') }}</p>
              </div>
              <Button v-if="libraries.length > 0" variant="outline" size="sm" type="button" class="shrink-0" @click="toggleAllLibraries">
                {{ allLibrariesSelected ? t('adminFeature.userForm.clearAll') : t('adminFeature.userForm.selectAll') }}
              </Button>
            </div>

            <p
              v-if="libraries.length === 0"
              class="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground"
            >
              {{ t('adminFeature.usersPage.defaultLibraryAccess.noLibraries') }}
            </p>
            <template v-else>
              <div class="grid gap-2 @lg:grid-cols-2">
                <label
                  v-for="library in libraries"
                  :key="library.id"
                  class="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 transition-colors hover:bg-muted focus-within:ring-2 focus-within:ring-ring"
                >
                  <input
                    type="checkbox"
                    :checked="selectedLibraryIds.has(library.id)"
                    class="size-4 shrink-0 rounded border-input accent-primary"
                    @change="toggleLibrary(library.id)"
                  />
                  <span class="min-w-0 flex-1 truncate text-sm text-foreground">{{ library.name }}</span>
                  <span v-if="library.bookCount !== undefined" class="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {{ t('adminFeature.userForm.libraryBookCount', { count: library.bookCount }) }}
                  </span>
                </label>
              </div>
              <p v-if="selectedLibraryIds.size === 0" class="flex items-center gap-2 text-xs text-[var(--pill-warning)]">
                <TriangleAlert :size="14" aria-hidden="true" />
                {{ t('adminFeature.userForm.noLibrariesSelected') }}
              </p>
              <p v-else-if="libraryReach" class="settings-hint">{{ t('adminFeature.userForm.libraryReach', libraryReach) }}</p>
            </template>
          </section>

          <UserPermissionsSection
            v-else-if="activeSection === 'permissions'"
            :selected="selectedPermissionNames"
            :granted="grantedCount"
            :total="totalPermissions"
            @toggle="togglePermission"
            @preset="applyPreset"
          />

          <UserRestrictionsSection
            v-else-if="activeSection === 'restrictions'"
            v-model:include-tags="includeTagItems"
            v-model:exclude-tags="excludeTagItems"
            v-model:include-genres="includeGenreItems"
            v-model:exclude-genres="excludeGenreItems"
            v-model:see-own-requested-books="seeOwnRequestedBooks"
            :is-edit="isEdit"
            :is-superuser-target="isSuperuserTarget"
            :selected="selectedPermissionNames"
            :content-filters-enabled="contentFiltersEnabled"
            @toggle="togglePermission"
            @update:content-filters-enabled="setContentFiltersEnabled"
          />
        </div>
      </div>

      <footer class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-border px-4 py-3 sm:px-5">
        <p v-if="errorMessage" role="alert" class="min-w-0 flex-1 basis-full text-sm text-destructive md:basis-auto">{{ errorMessage }}</p>
        <p v-else-if="changeCount > 0" class="flex min-w-0 flex-1 basis-full items-center gap-2 text-xs text-[var(--pill-warning)] md:basis-auto">
          <TriangleAlert :size="14" class="shrink-0" aria-hidden="true" />
          <span class="truncate">{{ t('adminFeature.userForm.unsavedChanges', { count: changeCount }) }}</span>
        </p>
        <span v-else class="hidden flex-1 md:block" />
        <div class="flex w-full gap-2 md:ms-auto md:w-auto">
          <Button variant="outline" size="sm" type="button" class="flex-1 md:flex-none" @click="handleClose">{{ t('common.cancel') }}</Button>
          <Button size="sm" type="button" class="flex-1 md:flex-none" :disabled="loading" @click="handleSubmit">
            {{ loading ? t('adminFeature.userForm.saving') : t('common.save') }}
          </Button>
        </div>
      </footer>
    </SheetContent>
  </Sheet>
</template>
