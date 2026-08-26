<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { ShieldAlert } from '@lucide/vue'
import { Permission, PERMISSION_LABELS } from '@bookorbit/types'
import ContentFilterChipInput from '@/components/ui/ContentFilterChipInput.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { RESTRICTION_PERMISSIONS } from '../lib/permission-presets'
import { useTagSearchWithIds, useGenreSearchWithIds } from '../composables/useContentFilterSearch'
import type { NamedItem } from '../composables/useUserForm'

const props = defineProps<{
  isEdit: boolean
  isSuperuserTarget: boolean
  selected: ReadonlySet<string>
  contentFiltersEnabled: boolean
}>()

const emit = defineEmits<{
  toggle: [permissionName: string]
  'update:contentFiltersEnabled': [enabled: boolean]
}>()

const includeTags = defineModel<NamedItem[]>('includeTags', { required: true })
const excludeTags = defineModel<NamedItem[]>('excludeTags', { required: true })
const includeGenres = defineModel<NamedItem[]>('includeGenres', { required: true })
const excludeGenres = defineModel<NamedItem[]>('excludeGenres', { required: true })
const seeOwnRequestedBooks = defineModel<boolean>('seeOwnRequestedBooks', { required: true })

const { t } = useI18n()
const { search: searchTags } = useTagSearchWithIds()
const { search: searchGenres } = useGenreSearchWithIds()

const contentFiltersId = useId()

/** Content filters are saved against an existing account, so creation has nowhere to put them. */
const canEditContentFilters = computed(() => props.isEdit && !props.isSuperuserTarget)

const restrictions = computed(() =>
  RESTRICTION_PERMISSIONS.map((permission) => ({
    name: permission,
    label: PERMISSION_LABELS[permission] ?? permission,
    hint: permission === Permission.DemoRestricted ? t('adminFeature.userForm.demoRestrictedHint') : '',
    checked: props.selected.has(permission),
  })),
)

function toggleRestriction(permissionName: string) {
  emit('toggle', permissionName)
}

function toggleContentFilters(enabled: boolean) {
  emit('update:contentFiltersEnabled', enabled)
}
</script>

<template>
  <section class="space-y-4">
    <div class="space-y-3">
      <div class="flex items-start gap-3">
        <div class="min-w-0">
          <h3 :id="contentFiltersId" class="settings-label">{{ t('adminFeature.userForm.contentRestrictions') }}</h3>
          <p class="settings-hint">{{ t('adminFeature.userForm.contentRestrictionsHint') }}</p>
        </div>
        <ToggleSwitch
          v-if="canEditContentFilters"
          :model-value="contentFiltersEnabled"
          :aria-labelledby="contentFiltersId"
          class="ms-auto mt-0.5"
          @update:model-value="toggleContentFilters"
        />
      </div>

      <div v-if="isSuperuserTarget" class="flex gap-3 rounded-lg border border-[var(--pill-warning)]/40 bg-[var(--pill-warning)]/10 px-3 py-2.5">
        <ShieldAlert :size="16" class="mt-0.5 shrink-0 text-[var(--pill-warning)]" aria-hidden="true" />
        <div>
          <p class="text-sm font-medium text-[var(--pill-warning)]">{{ t('adminFeature.userForm.superuserTarget') }}</p>
          <p class="settings-hint">{{ t('adminFeature.userForm.superuserTargetHint') }}</p>
        </div>
      </div>

      <p v-else-if="!isEdit" class="rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
        {{ t('adminFeature.userForm.contentRestrictionsAfterCreate') }}
      </p>

      <div v-else-if="contentFiltersEnabled" class="grid gap-3 @lg:grid-cols-2">
        <div class="space-y-1.5">
          <label class="settings-label block text-xs">{{ t('adminFeature.userForm.includeTags') }}</label>
          <ContentFilterChipInput v-model="includeTags" :placeholder="t('adminFeature.userForm.searchTagsPlaceholder')" :search-fn="searchTags" />
          <p class="settings-hint">{{ t('adminFeature.userForm.includeTagsHint') }}</p>
        </div>
        <div class="space-y-1.5">
          <label class="settings-label block text-xs">{{ t('adminFeature.userForm.excludeTags') }}</label>
          <ContentFilterChipInput v-model="excludeTags" :placeholder="t('adminFeature.userForm.searchTagsPlaceholder')" :search-fn="searchTags" />
          <p class="settings-hint">{{ t('adminFeature.userForm.excludeTagsHint') }}</p>
        </div>
        <div class="space-y-1.5">
          <label class="settings-label block text-xs">{{ t('adminFeature.userForm.includeGenres') }}</label>
          <ContentFilterChipInput
            v-model="includeGenres"
            :placeholder="t('adminFeature.userForm.searchGenresPlaceholder')"
            :search-fn="searchGenres"
          />
          <p class="settings-hint">{{ t('adminFeature.userForm.includeGenresHint') }}</p>
        </div>
        <div class="space-y-1.5">
          <label class="settings-label block text-xs">{{ t('adminFeature.userForm.excludeGenres') }}</label>
          <ContentFilterChipInput
            v-model="excludeGenres"
            :placeholder="t('adminFeature.userForm.searchGenresPlaceholder')"
            :search-fn="searchGenres"
          />
          <p class="settings-hint">{{ t('adminFeature.userForm.excludeGenresHint') }}</p>
        </div>
        <label class="flex cursor-pointer items-start gap-2 focus-within:ring-2 focus-within:ring-ring @lg:col-span-2">
          <input v-model="seeOwnRequestedBooks" type="checkbox" class="mt-0.5 size-4 shrink-0 rounded border-input accent-primary" />
          <span>
            <span class="block text-sm leading-tight text-foreground">{{ t('adminFeature.userForm.seeOwnRequestedBooks') }}</span>
            <span class="settings-hint block">{{ t('adminFeature.userForm.seeOwnRequestedBooksHint') }}</span>
          </span>
        </label>
      </div>

      <p v-else class="rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
        {{ t('adminFeature.userForm.noRestrictionsHint') }}
      </p>
    </div>

    <fieldset class="space-y-2 rounded-lg border border-border bg-card px-3 pb-2.5 pt-2">
      <legend class="sr-only">{{ t('adminFeature.userForm.accountRestrictions') }}</legend>
      <p aria-hidden="true" class="text-xs font-semibold text-foreground">{{ t('adminFeature.userForm.accountRestrictions') }}</p>
      <label
        v-for="restriction in restrictions"
        :key="restriction.name"
        class="flex cursor-pointer items-start gap-2 focus-within:ring-2 focus-within:ring-ring"
      >
        <input
          type="checkbox"
          :checked="restriction.checked"
          class="mt-0.5 size-4 shrink-0 rounded border-input accent-primary"
          @change="toggleRestriction(restriction.name)"
        />
        <span>
          <span class="block text-sm leading-tight text-foreground">{{ restriction.label }}</span>
          <span class="settings-hint block">{{ restriction.hint }}</span>
        </span>
      </label>
    </fieldset>
  </section>
</template>
