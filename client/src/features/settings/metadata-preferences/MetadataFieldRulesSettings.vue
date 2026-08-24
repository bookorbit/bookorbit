<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Info, Loader2 } from '@lucide/vue'
import type { FieldPreference, MetadataField, MetadataFetchOptions, MetadataProviderKey } from '@bookorbit/types'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { useProviderConfig } from './composables/useProviderConfig'
import { useFieldRuleScopes, type FieldRuleScopeId } from './composables/useFieldRuleScopes'
import FieldRulesScopeTabs from './components/FieldRulesScopeTabs.vue'
import FieldRulesToolbar from './components/FieldRulesToolbar.vue'
import FieldRulesTable from './components/FieldRulesTable.vue'
import FieldRulesSaveBar from './components/FieldRulesSaveBar.vue'
import AdvancedFetchOptions from './components/AdvancedFetchOptions.vue'
import { fieldsMatching, type ProviderBulkAction } from './lib/field-rules'

const { t } = useI18n()
const { statuses, fetchConfig } = useProviderConfig()
const scopes = useFieldRuleScopes()

const query = ref('')
const providerFilter = ref<MetadataProviderKey | null>(null)
const overriddenOnly = ref(false)
/** Advanced options carry the only client-side validation on the page. */
const optionsValid = ref(true)

onMounted(() => {
  void Promise.all([fetchConfig(), scopes.load()]).catch(() => undefined)
})

// Filters describe the scope on screen. Carrying "overrides only" onto the global scope
// would silently hide every row, since global rules are never overrides.
watch(
  () => scopes.activeScopeId.value,
  () => {
    overriddenOnly.value = false
  },
)

const fieldLabel = (field: MetadataField) => t(`settings.metadata.fields.${field}`)

const visibleFields = computed(() => {
  const fields = scopes.activeFields.value
  if (!fields) return new Set<MetadataField>()
  return fieldsMatching(
    fields,
    {
      query: query.value,
      provider: providerFilter.value,
      overriddenOnly: overriddenOnly.value,
      overridden: scopes.overriddenFields.value,
    },
    fieldLabel,
  )
})

type PendingConfirm = { kind: 'clearProviders' } | { kind: 'resetScope' } | { kind: 'bulkRemove'; provider: MetadataProviderKey }
const pendingConfirm = ref<PendingConfirm | null>(null)
const confirmBusy = ref(false)

const confirmCopy = computed(() => {
  const pending = pendingConfirm.value
  const scope = scopes.activeScope.value.name
  if (!pending) return null
  if (pending.kind === 'clearProviders') {
    return {
      title: t('settings.metadata.fieldRules.confirm.clearProviders.title'),
      description: t('settings.metadata.fieldRules.confirm.clearProviders.description', { scope }),
      confirmLabel: t('settings.metadata.fieldRules.clearAllProviders'),
    }
  }
  if (pending.kind === 'resetScope') {
    return {
      title: t('settings.metadata.fieldRules.confirm.resetScope.title'),
      description: scopes.isGlobalScope.value
        ? t('settings.metadata.fieldRules.confirm.resetScope.globalDescription')
        : t('settings.metadata.fieldRules.confirm.resetScope.libraryDescription', { scope }),
      confirmLabel: t('settings.metadata.fieldRules.resetToDefault'),
    }
  }
  const provider = statuses.value.find((status) => status.key === pending.provider)?.label ?? pending.provider
  return {
    title: t('settings.metadata.fieldRules.confirm.removeProvider.title', { provider }),
    description: t('settings.metadata.fieldRules.confirm.removeProvider.description', { provider, scope }),
    confirmLabel: t('settings.metadata.fieldRules.toolbar.removeEverywhere'),
  }
})

function onFieldChange(field: MetadataField, pref: FieldPreference) {
  scopes.setField(field, pref)
}

function onFieldRevert(field: MetadataField) {
  scopes.revertField(field)
}

function onScopeSelect(id: FieldRuleScopeId) {
  scopes.activeScopeId.value = id
}

function onOptionsChange(options: MetadataFetchOptions) {
  scopes.setOptions(options)
}

function onOptionsValidChange(valid: boolean) {
  optionsValid.value = valid
}

// Reordering is reversible and stays in the draft; removing a provider from every field is
// the one bulk action worth a confirmation.
function onBulk(provider: MetadataProviderKey, action: ProviderBulkAction) {
  if (action === 'remove') {
    pendingConfirm.value = { kind: 'bulkRemove', provider }
    return
  }
  scopes.applyProviderToAllFields(provider, action)
}

function requestClearProviders() {
  pendingConfirm.value = { kind: 'clearProviders' }
}

function requestResetScope() {
  pendingConfirm.value = { kind: 'resetScope' }
}

function cancelConfirm() {
  if (!confirmBusy.value) pendingConfirm.value = null
}

async function acceptConfirm() {
  const pending = pendingConfirm.value
  if (!pending) return
  if (pending.kind === 'clearProviders') {
    scopes.clearAllProviders()
  } else if (pending.kind === 'bulkRemove') {
    scopes.applyProviderToAllFields(pending.provider, 'remove')
  } else {
    confirmBusy.value = true
    try {
      await scopes.resetScope()
    } finally {
      confirmBusy.value = false
    }
  }
  pendingConfirm.value = null
}

function clearFilters() {
  query.value = ''
  providerFilter.value = null
  overriddenOnly.value = false
}

function onSave() {
  void scopes.save()
}

function onDiscard() {
  scopes.discard()
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-start gap-3 rounded-lg border border-primary/15 bg-primary/5 px-4 py-3 shadow-xs">
      <Info :size="16" class="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
      <p class="text-xs leading-relaxed text-muted-foreground">
        <span class="font-medium text-foreground">{{ t('settings.metadata.fieldRules.howItWorks.title') }}</span>
        {{ ' ' }}{{ t('settings.metadata.fieldRules.howItWorks.summary') }}
      </p>
    </div>

    <div class="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
      <FieldRulesScopeTabs :scopes="scopes.scopes.value" :active-id="scopes.activeScopeId.value" @select="onScopeSelect" />

      <template v-if="scopes.activeFields.value">
        <FieldRulesToolbar
          v-model:query="query"
          v-model:provider-filter="providerFilter"
          v-model:overridden-only="overriddenOnly"
          :fields="scopes.activeFields.value"
          :statuses="statuses"
          :is-global-scope="scopes.isGlobalScope.value"
          :disabled="scopes.saving.value"
          @bulk="onBulk"
          @clear-providers="requestClearProviders"
          @reset-scope="requestResetScope"
        />

        <FieldRulesTable
          :fields="scopes.activeFields.value"
          :statuses="statuses"
          :visible-fields="visibleFields"
          :overridden-fields="scopes.overriddenFields.value"
          :unsaved-fields="scopes.unsavedFields.value"
          :is-global-scope="scopes.isGlobalScope.value"
          :scope-name="scopes.activeScope.value.name"
          :saving="scopes.saving.value"
          @change="onFieldChange"
          @revert="onFieldRevert"
          @clear-filters="clearFilters"
        />

        <AdvancedFetchOptions
          v-if="scopes.isGlobalScope.value && scopes.optionsDraft.value"
          :options="scopes.optionsDraft.value"
          :disabled="scopes.saving.value"
          @change="onOptionsChange"
          @update:valid="onOptionsValidChange"
        />

        <FieldRulesSaveBar
          :dirty="scopes.isDirty.value"
          :unsaved-count="scopes.activeScope.value.unsavedCount"
          :scope-name="scopes.activeScope.value.name"
          :saving="scopes.saving.value"
          :blocked="scopes.isGlobalScope.value && !optionsValid"
          @save="onSave"
          @discard="onDiscard"
        />
      </template>

      <div v-else class="flex items-center justify-center px-6 py-16">
        <Loader2 :size="24" class="animate-spin text-muted-foreground" aria-hidden="true" />
        <span class="sr-only">{{ t('common.loading') }}</span>
      </div>
    </div>

    <ConfirmDialog
      v-if="confirmCopy"
      :open="pendingConfirm !== null"
      :title="confirmCopy.title"
      :description="confirmCopy.description"
      :confirm-label="confirmCopy.confirmLabel"
      :busy="confirmBusy"
      @confirm="acceptConfirm"
      @cancel="cancelConfirm"
    />
  </div>
</template>
