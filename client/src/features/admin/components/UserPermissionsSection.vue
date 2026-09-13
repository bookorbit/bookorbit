<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search } from '@lucide/vue'
import { Permission, PERMISSION_LABELS } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import {
  PERMISSION_GROUPS,
  detectPermissionSelection,
  permissionsInGroup,
  type PermissionPreset,
  type PermissionSelection,
} from '../lib/permission-presets'

const props = defineProps<{
  selected: ReadonlySet<string>
  total: number
  granted: number
}>()

const emit = defineEmits<{
  toggle: [permissionName: string]
  preset: [preset: PermissionPreset]
}>()

const { t } = useI18n()

const filter = ref('')
const grantedOnly = ref(false)

const selection = computed<PermissionSelection>(() => detectPermissionSelection(props.selected))

interface PresetOption {
  id: PermissionSelection
  label: string
  preset?: PermissionPreset
}

const presetOptions = computed<PresetOption[]>(() => [
  { id: 'clear', label: t('adminFeature.userForm.presets.none'), preset: 'clear' },
  { id: 'standard', label: t('adminFeature.userForm.presets.standard'), preset: 'standard' },
  { id: 'custom', label: t('adminFeature.userForm.presets.custom') },
  { id: 'admin', label: t('adminFeature.userForm.presets.admin'), preset: 'admin' },
])

function permissionLabel(permission: Permission): string {
  if (permission === Permission.ViewUserActivity) return t('adminFeature.accountActivity.permissionLabel')
  return PERMISSION_LABELS[permission] ?? permission
}

interface PermissionRow {
  name: Permission
  label: string
  manage: boolean
  checked: boolean
}

interface RenderedGroup {
  id: string
  label: string
  legend: string
  granted: number
  total: number
  /** Every permission is administration-level, so one group tag replaces a tag on every row. */
  manageOnly: boolean
  /** Groups past four permissions run the full width rather than squeezing into a column. */
  wide: boolean
  rows: PermissionRow[]
}

const groups = computed<RenderedGroup[]>(() => {
  const query = filter.value.trim().toLowerCase()

  return PERMISSION_GROUPS.map((group) => {
    const label = t(`adminFeature.userForm.permissionGroups.${group.id}`)
    const groupMatches = query.length > 0 && label.toLowerCase().includes(query)
    const permissions = permissionsInGroup(group)

    const rows = permissions
      .map((permission) => ({
        name: permission,
        label: permissionLabel(permission),
        manage: group.manage.includes(permission),
        checked: props.selected.has(permission),
      }))
      .filter((row) => (grantedOnly.value ? row.checked : true))
      .filter((row) => (query.length === 0 || groupMatches ? true : row.label.toLowerCase().includes(query)))

    const granted = permissions.filter((permission) => props.selected.has(permission)).length

    return {
      id: group.id,
      label,
      legend: t('adminFeature.userForm.groupLegend', { group: label, granted: formatNumber(granted), total: formatNumber(permissions.length) }),
      granted,
      total: permissions.length,
      manageOnly: group.use.length === 0,
      wide: permissions.length > 4,
      rows,
    }
  }).filter((group) => group.rows.length > 0)
})

const isFiltering = computed(() => filter.value.trim().length > 0 || grantedOnly.value)

function applyPreset(option: PresetOption) {
  if (!option.preset) return
  emit('preset', option.preset)
}

function togglePermission(permissionName: string) {
  emit('toggle', permissionName)
}

function toggleGrantedOnly() {
  grantedOnly.value = !grantedOnly.value
}

function clearFilters() {
  filter.value = ''
  grantedOnly.value = false
}
</script>

<template>
  <section class="space-y-3">
    <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div class="min-w-0">
        <h3 class="settings-label sr-only md:not-sr-only">{{ t('adminFeature.userForm.permissions') }}</h3>
        <p class="settings-hint">
          {{ t('adminFeature.userForm.permissionsHint', { granted: formatNumber(granted), total: formatNumber(total) }) }}
        </p>
      </div>
      <div
        role="group"
        :aria-label="t('adminFeature.userForm.presets.label')"
        class="flex shrink-0 gap-0.5 rounded-lg border border-border bg-muted p-0.5"
      >
        <button
          v-for="option in presetOptions"
          :key="option.id"
          type="button"
          :aria-pressed="selection === option.id"
          :disabled="!option.preset"
          :title="option.preset ? undefined : t('adminFeature.userForm.presets.customHint')"
          class="rounded-[7px] px-2.5 py-1 text-xs transition-colors disabled:cursor-default"
          :class="
            selection === option.id
              ? 'bg-card font-semibold text-foreground shadow-xs'
              : option.preset
                ? 'text-muted-foreground hover:text-foreground'
                : 'text-muted-foreground'
          "
          @click="applyPreset(option)"
        >
          {{ option.label }}
        </button>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <div class="relative min-w-[10rem] flex-1">
        <Search :size="14" class="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          v-model="filter"
          type="search"
          :placeholder="t('adminFeature.userForm.filterPermissions')"
          :aria-label="t('adminFeature.userForm.filterPermissions')"
          class="h-9 w-full rounded-lg border border-input bg-background ps-9 pe-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>
      <button
        type="button"
        :aria-pressed="grantedOnly"
        class="h-9 shrink-0 rounded-lg border px-3 text-xs font-medium transition-colors"
        :class="grantedOnly ? 'border-primary/40 bg-primary/10 text-primary' : 'border-input text-muted-foreground hover:text-foreground'"
        @click="toggleGrantedOnly"
      >
        {{ t('adminFeature.userForm.grantedOnly') }}
      </button>
    </div>

    <div v-if="groups.length === 0" class="rounded-lg border border-dashed border-border px-4 py-8 text-center">
      <p class="text-sm text-foreground">{{ t('adminFeature.userForm.noPermissionMatches') }}</p>
      <button type="button" class="mt-2 text-xs font-medium text-primary hover:underline" @click="clearFilters">
        {{ t('adminFeature.userForm.clearFilters') }}
      </button>
    </div>

    <div v-else class="grid gap-2.5 @lg:grid-cols-2">
      <fieldset
        v-for="group in groups"
        :key="group.id"
        class="rounded-lg border border-border bg-card px-3 pb-2.5 pt-2"
        :class="group.wide ? '@lg:col-span-2' : ''"
      >
        <legend class="sr-only">{{ group.legend }}</legend>
        <div class="mb-1.5 flex items-center gap-2">
          <span aria-hidden="true" class="text-xs font-semibold text-foreground">{{ group.label }}</span>
          <span
            v-if="group.manageOnly"
            aria-hidden="true"
            class="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {{ t('adminFeature.userForm.permissionLevels.manage') }}
          </span>
          <span aria-hidden="true" class="ms-auto text-[11px] font-semibold tabular-nums text-muted-foreground">
            {{ formatNumber(group.granted) }}/{{ formatNumber(group.total) }}
          </span>
        </div>
        <div :class="group.wide ? 'grid gap-x-4 @md:grid-cols-2 @xl:grid-cols-3' : ''">
          <label
            v-for="row in group.rows"
            :key="row.name"
            class="flex cursor-pointer items-start gap-2 rounded py-1 focus-within:ring-2 focus-within:ring-ring"
          >
            <input
              type="checkbox"
              :checked="row.checked"
              class="mt-0.5 size-4 shrink-0 rounded border-input accent-primary"
              @change="togglePermission(row.name)"
            />
            <span class="text-sm leading-tight text-foreground">{{ row.label }}</span>
            <span
              v-if="row.manage && !group.manageOnly"
              class="ms-auto mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {{ t('adminFeature.userForm.permissionLevels.manage') }}
            </span>
          </label>
        </div>
      </fieldset>
    </div>

    <p v-if="isFiltering && groups.length > 0" class="text-xs text-muted-foreground">
      {{ t('adminFeature.userForm.filteredNotice') }}
    </p>
  </section>
</template>
