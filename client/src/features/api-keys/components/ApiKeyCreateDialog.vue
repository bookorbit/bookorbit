<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ShieldAlert } from '@lucide/vue'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import {
  API_KEY_GRANTABLE_PERMISSIONS,
  API_KEY_NAME_MAX_LENGTH,
  type ApiKeyAccess,
  type CreateApiKeyRequest,
  type Permission,
} from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { formatNumber } from '@/i18n/formatters'
import { PERMISSION_GROUPS, permissionsInGroup } from '@/features/admin/lib/permission-presets'
import { permissionLabel } from '@/features/admin/lib/permission-labels'
import { defaultExpiryChoice, expiryChoices, type ExpiryChoice } from '../lib/api-key-options'

interface LibraryOption {
  id: number
  name: string
}

const props = withDefaults(
  defineProps<{
    open: boolean
    /** The longest lifetime the server allows, or null for no limit. */
    maxLifetimeDays: number | null
    /** What the key's owner holds: a key can be granted at most that. */
    ownerIsSuperuser: boolean
    ownerPermissions: readonly string[]
    /** The libraries the owner can see, which are the only ones a key may be limited to. */
    libraries: readonly LibraryOption[]
    /** True when an administrator issues the key for someone else. */
    issuing?: boolean
    busy?: boolean
    error?: string | null
  }>(),
  { issuing: false, busy: false, error: null },
)

const emit = defineEmits<{ submit: [request: CreateApiKeyRequest]; cancel: [] }>()

const { t } = useI18n()
const formId = `api-key-create-${useId()}`

const name = ref('')
const expiryId = ref('')
const access = ref<ApiKeyAccess>('read')
const selectedPermissions = ref<Set<string>>(new Set())
const libraryMode = ref<'all' | 'some'>('all')
const selectedLibraries = ref<Set<number>>(new Set())
const admin = ref(false)

const choices = computed(() => expiryChoices(props.maxLifetimeDays))

const permissionGroups = computed(() => {
  const held = (permission: Permission) => props.ownerIsSuperuser || props.ownerPermissions.includes(permission)
  return PERMISSION_GROUPS.map((group) => ({
    id: group.id,
    label: t(`adminFeature.userForm.permissionGroups.${group.id}`),
    rows: permissionsInGroup(group)
      .filter((permission) => API_KEY_GRANTABLE_PERMISSIONS.includes(permission) && held(permission))
      .map((permission) => ({ name: permission, label: permissionLabel(permission, t) })),
  })).filter((group) => group.rows.length > 0)
})

const hasGrantablePermissions = computed(() => permissionGroups.value.length > 0)
const nameValid = computed(() => name.value.trim().length > 0)
const librariesValid = computed(() => libraryMode.value === 'all' || selectedLibraries.value.size > 0)
const canSubmit = computed(() => !props.busy && nameValid.value && librariesValid.value)

const selectedLibrariesSummary = computed(() =>
  t('apiKeys.create.librariesSelected', { count: selectedLibraries.value.size, total: formatNumber(props.libraries.length) }),
)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    name.value = ''
    expiryId.value = defaultExpiryChoice(choices.value)
    access.value = 'read'
    selectedPermissions.value = new Set()
    libraryMode.value = 'all'
    selectedLibraries.value = new Set()
    admin.value = false
  },
  { immediate: true },
)

function expiryLabel(choice: ExpiryChoice): string {
  return choice.days === null ? t('apiKeys.expiry.never') : t('apiKeys.expiry.days', { count: choice.days })
}

function togglePermission(permission: string) {
  const next = new Set(selectedPermissions.value)
  if (next.has(permission)) next.delete(permission)
  else next.add(permission)
  selectedPermissions.value = next
}

function toggleLibrary(libraryId: number) {
  const next = new Set(selectedLibraries.value)
  if (next.has(libraryId)) next.delete(libraryId)
  else next.add(libraryId)
  selectedLibraries.value = next
}

function handleOpenChange(open: boolean) {
  if (!open && !props.busy) emit('cancel')
}

function handleCancel() {
  if (!props.busy) emit('cancel')
}

function handleSubmit() {
  if (!canSubmit.value) return
  const choice = choices.value.find((option) => option.id === expiryId.value)
  const request: CreateApiKeyRequest = {
    name: name.value.trim(),
    access: access.value,
    permissions: admin.value ? [] : [...selectedPermissions.value],
    admin: admin.value,
    libraryIds: libraryMode.value === 'some' ? [...selectedLibraries.value] : null,
  }
  if (choice && choice.request !== undefined) request.expiresInDays = choice.request
  emit('submit', request)
}
</script>

<template>
  <DialogRoot :open="open" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[60] bg-scrim" />
      <DialogContent
        aria-modal="true"
        class="fixed left-1/2 top-1/2 z-[60] flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-card shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div class="border-b border-border px-5 pb-4 pt-5">
          <DialogTitle class="text-lg font-semibold text-foreground">
            {{ issuing ? t('apiKeys.create.issueTitle') : t('apiKeys.create.title') }}
          </DialogTitle>
          <DialogDescription class="mt-1 text-sm text-muted-foreground">
            {{ issuing ? t('apiKeys.create.issueDescription') : t('apiKeys.create.description') }}
          </DialogDescription>
        </div>

        <form :id="formId" class="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4" @submit.prevent="handleSubmit">
          <div class="space-y-1.5">
            <label :for="`${formId}-name`" class="settings-label block">{{ t('apiKeys.create.name') }}</label>
            <input
              :id="`${formId}-name`"
              v-model="name"
              type="text"
              required
              autocomplete="off"
              :maxlength="API_KEY_NAME_MAX_LENGTH"
              :placeholder="t('apiKeys.create.namePlaceholder')"
              class="input-field w-full"
            />
            <p class="settings-hint">{{ t('apiKeys.create.nameHint') }}</p>
          </div>

          <fieldset class="space-y-2">
            <legend class="settings-label">{{ t('apiKeys.create.expiry') }}</legend>
            <div class="flex flex-wrap gap-2">
              <label
                v-for="choice in choices"
                :key="choice.id"
                class="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors focus-within:ring-2 focus-within:ring-ring"
                :class="expiryId === choice.id ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border text-foreground hover:bg-muted'"
              >
                <input v-model="expiryId" type="radio" :name="`${formId}-expiry`" :value="choice.id" class="size-4 accent-primary" />
                {{ expiryLabel(choice) }}
              </label>
            </div>
            <p v-if="maxLifetimeDays !== null" class="settings-hint">{{ t('apiKeys.create.expiryCapped', { count: maxLifetimeDays }) }}</p>
          </fieldset>

          <fieldset class="space-y-2">
            <legend class="settings-label">{{ t('apiKeys.create.access') }}</legend>
            <div class="grid gap-2 sm:grid-cols-2">
              <label
                class="flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors focus-within:ring-2 focus-within:ring-ring"
                :class="access === 'read' ? 'border-primary/50 bg-primary/10' : 'border-border hover:bg-muted'"
              >
                <input v-model="access" type="radio" :name="`${formId}-access`" value="read" class="mt-0.5 size-4 shrink-0 accent-primary" />
                <span>
                  <span class="block text-sm font-medium text-foreground">{{ t('apiKeys.access.read') }}</span>
                  <span class="settings-hint block">{{ t('apiKeys.access.readHint') }}</span>
                </span>
              </label>
              <label
                class="flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors focus-within:ring-2 focus-within:ring-ring"
                :class="access === 'write' ? 'border-primary/50 bg-primary/10' : 'border-border hover:bg-muted'"
              >
                <input v-model="access" type="radio" :name="`${formId}-access`" value="write" class="mt-0.5 size-4 shrink-0 accent-primary" />
                <span>
                  <span class="block text-sm font-medium text-foreground">{{ t('apiKeys.access.write') }}</span>
                  <span class="settings-hint block">{{ t('apiKeys.access.writeHint') }}</span>
                </span>
              </label>
            </div>
          </fieldset>

          <fieldset class="space-y-2">
            <legend class="settings-label">{{ t('apiKeys.create.libraries') }}</legend>
            <div class="space-y-1.5">
              <label class="flex cursor-pointer items-center gap-2.5 text-sm text-foreground">
                <input v-model="libraryMode" type="radio" :name="`${formId}-libraries`" value="all" class="size-4 accent-primary" />
                {{ issuing ? t('apiKeys.create.librariesAllTheirs') : t('apiKeys.create.librariesAll') }}
              </label>
              <label
                class="flex items-center gap-2.5 text-sm"
                :class="admin ? 'cursor-not-allowed text-muted-foreground' : 'cursor-pointer text-foreground'"
              >
                <input
                  v-model="libraryMode"
                  type="radio"
                  :name="`${formId}-libraries`"
                  value="some"
                  :disabled="admin || libraries.length === 0"
                  class="size-4 accent-primary"
                />
                {{ t('apiKeys.create.librariesSome') }}
              </label>
            </div>
            <div v-if="libraryMode === 'some'" class="space-y-1.5 ps-6">
              <div class="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border bg-background p-2">
                <label
                  v-for="library in libraries"
                  :key="library.id"
                  class="flex cursor-pointer items-center gap-2.5 rounded-xs px-1.5 py-1 text-sm text-foreground hover:bg-muted focus-within:ring-2 focus-within:ring-ring"
                >
                  <input
                    type="checkbox"
                    :checked="selectedLibraries.has(library.id)"
                    class="size-4 shrink-0 rounded-xs accent-primary"
                    @change="toggleLibrary(library.id)"
                  />
                  <span class="min-w-0 truncate">{{ library.name }}</span>
                </label>
              </div>
              <p class="settings-hint" :class="librariesValid ? '' : 'text-destructive'">
                {{ librariesValid ? selectedLibrariesSummary : t('apiKeys.create.librariesRequired') }}
              </p>
            </div>
          </fieldset>

          <div v-if="ownerIsSuperuser" class="rounded-lg border border-border bg-muted p-3">
            <label class="flex items-start gap-2.5" :class="libraryMode === 'some' ? 'cursor-not-allowed' : 'cursor-pointer'">
              <input
                v-model="admin"
                type="checkbox"
                :disabled="libraryMode === 'some'"
                :aria-describedby="`${formId}-admin-hint`"
                class="mt-0.5 size-4 shrink-0 rounded-xs accent-primary"
              />
              <span>
                <span class="block text-sm font-medium text-foreground">{{ t('apiKeys.create.admin') }}</span>
                <span :id="`${formId}-admin-hint`" class="settings-hint block">
                  {{ libraryMode === 'some' ? t('apiKeys.create.adminWithLibraries') : t('apiKeys.create.adminHint') }}
                </span>
              </span>
            </label>
            <p v-if="admin" role="note" class="mt-2 flex items-start gap-2 text-xs text-[var(--pill-warning)]">
              <ShieldAlert :size="14" class="mt-px shrink-0" aria-hidden="true" />
              <span>{{ t('apiKeys.create.adminWarning') }}</span>
            </p>
          </div>

          <fieldset v-if="!admin" class="space-y-2">
            <legend class="settings-label">{{ t('apiKeys.create.permissions') }}</legend>
            <p class="settings-hint">{{ t('apiKeys.create.permissionsHint') }}</p>
            <p v-if="!hasGrantablePermissions" class="text-sm text-muted-foreground">{{ t('apiKeys.create.noPermissions') }}</p>
            <div v-else class="grid gap-2 sm:grid-cols-2">
              <div v-for="group in permissionGroups" :key="group.id" class="rounded-lg border border-border px-3 pb-2 pt-1.5">
                <p class="mb-1 text-xs font-semibold text-foreground">{{ group.label }}</p>
                <label
                  v-for="row in group.rows"
                  :key="row.name"
                  class="flex cursor-pointer items-start gap-2 rounded-xs py-1 focus-within:ring-2 focus-within:ring-ring"
                >
                  <input
                    type="checkbox"
                    :checked="selectedPermissions.has(row.name)"
                    class="mt-0.5 size-4 shrink-0 rounded-xs accent-primary"
                    @change="togglePermission(row.name)"
                  />
                  <span class="text-sm leading-tight text-foreground">{{ row.label }}</span>
                </label>
              </div>
            </div>
          </fieldset>

          <p v-if="error" role="alert" class="settings-error-state">{{ error }}</p>
        </form>

        <div class="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button type="button" variant="outline" :disabled="busy" @click="handleCancel">{{ t('common.cancel') }}</Button>
          <Button type="submit" :form="formId" :disabled="!canSubmit">
            {{ busy ? t('apiKeys.create.creating') : issuing ? t('apiKeys.create.issueSubmit') : t('apiKeys.create.submit') }}
          </Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
