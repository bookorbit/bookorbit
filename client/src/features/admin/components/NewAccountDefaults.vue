<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Save } from '@lucide/vue'

import { Button } from '@/components/ui/button'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { formatNumber } from '@/i18n/formatters'
import type { UserLibrary } from '../composables/useUsers'
import StatusPill from './StatusPill.vue'

defineProps<{
  showSelfRegistration: boolean
  showLibraryDefaults: boolean
  allowRegistration: boolean
  savingSelfRegistration: boolean
  selfRegistrationError: string | null
  libraries: UserLibrary[]
  selectedLibraryIds: Set<number>
  savingLibraryDefaults: boolean
  libraryDefaultsError: string | null
  hasLibraryChanges: boolean
}>()

const emit = defineEmits<{
  toggleSelfRegistration: []
  toggleLibrary: [id: number]
  saveLibraryDefaults: []
}>()

const { t } = useI18n()

function toggleSelfRegistration() {
  emit('toggleSelfRegistration')
}

function toggleLibrary(id: number) {
  emit('toggleLibrary', id)
}

function saveLibraryDefaults() {
  emit('saveLibraryDefaults')
}
</script>

<template>
  <section aria-labelledby="new-account-defaults-heading" class="border-t border-border/70 pt-5">
    <div class="mb-3 flex items-center gap-3">
      <h3 id="new-account-defaults-heading" class="settings-group-label mb-0">{{ t('adminFeature.usersPage.defaults.title') }}</h3>
      <span class="h-px flex-1 bg-border" aria-hidden="true" />
      <p class="text-xs text-muted-foreground">{{ t('adminFeature.usersPage.defaults.appliesTo') }}</p>
    </div>

    <div class="grid gap-3 lg:grid-cols-2">
      <div v-if="showSelfRegistration" class="rounded-lg border border-border bg-card shadow-xs">
        <div class="flex items-center gap-3 p-4">
          <div class="min-w-0">
            <p class="settings-label">{{ t('adminFeature.usersPage.selfRegistration.label') }}</p>
            <p class="settings-hint">{{ t('adminFeature.usersPage.selfRegistration.hint') }}</p>
          </div>
          <ToggleSwitch
            :model-value="allowRegistration"
            :disabled="savingSelfRegistration"
            :aria-label="t('adminFeature.usersPage.selfRegistration.label')"
            class="ms-auto shrink-0"
            @update:model-value="toggleSelfRegistration"
          />
        </div>
        <p v-if="allowRegistration" class="px-4 pb-4 text-xs text-muted-foreground">
          {{ t('adminFeature.usersPage.selfRegistration.enabledNotice') }}
        </p>
        <p v-if="selfRegistrationError" role="alert" class="px-4 pb-4 text-sm text-destructive">
          {{
            selfRegistrationError === 'save'
              ? t('adminFeature.usersPage.selfRegistration.saveError')
              : t('adminFeature.usersPage.selfRegistration.loadError')
          }}
        </p>
      </div>

      <div v-if="showLibraryDefaults" class="rounded-lg border border-border bg-card shadow-xs">
        <div class="flex items-center gap-3 p-4 pb-3">
          <div class="min-w-0">
            <p class="settings-label flex items-center gap-2">
              {{ t('adminFeature.usersPage.defaults.startingLibraries') }}
              <StatusPill tone="neutral">
                {{
                  t('adminFeature.usersPage.libraries.some', {
                    granted: formatNumber(selectedLibraryIds.size),
                    total: formatNumber(libraries.length),
                  })
                }}
              </StatusPill>
            </p>
            <p class="settings-hint">{{ t('adminFeature.usersPage.defaults.startingLibrariesHint') }}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            type="button"
            class="ms-auto shrink-0"
            :disabled="savingLibraryDefaults || !hasLibraryChanges"
            @click="saveLibraryDefaults"
          >
            <Save :size="14" aria-hidden="true" />
            {{ savingLibraryDefaults ? t('adminFeature.usersPage.defaultLibraryAccess.saving') : t('common.save') }}
          </Button>
        </div>
        <div v-if="libraries.length > 0" class="flex flex-wrap gap-2 px-4 pb-4">
          <label
            v-for="library in libraries"
            :key="library.id"
            class="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-secondary px-2.5 py-1.5 text-sm transition-colors hover:bg-muted focus-within:ring-2 focus-within:ring-ring"
            :class="selectedLibraryIds.has(library.id) ? 'border-primary/45 bg-primary/10 text-foreground' : 'text-muted-foreground'"
          >
            <input
              type="checkbox"
              :checked="selectedLibraryIds.has(library.id)"
              class="size-3.5 rounded border-input accent-primary"
              @change="toggleLibrary(library.id)"
            />
            <span class="min-w-0 truncate">{{ library.name }}</span>
          </label>
        </div>
        <p v-else class="px-4 pb-4 text-sm text-muted-foreground">{{ t('adminFeature.usersPage.defaultLibraryAccess.noLibraries') }}</p>
        <p v-if="libraryDefaultsError" role="alert" class="px-4 pb-4 text-sm text-destructive">{{ libraryDefaultsError }}</p>
      </div>
    </div>
  </section>
</template>
