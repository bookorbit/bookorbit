<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2 } from '@lucide/vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import SettingsPageHeader from './SettingsPageHeader.vue'
import NamingRuleRail, { type RailGroup, type RailItem } from './file-naming/components/NamingRuleRail.vue'
import NamingRuleEditor, { type RuleLink } from './file-naming/components/NamingRuleEditor.vue'
import FileNamingSaveBar from './file-naming/components/FileNamingSaveBar.vue'
import PatternExamplesSheet from './file-naming/components/PatternExamplesSheet.vue'
import { useDebouncedPatternPreview } from './composables/useDebouncedPatternPreview'
import { useFileNamingRules } from './file-naming/composables/useFileNamingRules'
import {
  GLOBAL_RULE_ICONS,
  globalKeyForMode,
  globalRule,
  librariesGovernedBy,
  type NamingRule,
  type NamingRuleId,
} from './file-naming/lib/naming-rules'
import type { PreviewBookId } from './file-naming/lib/preview-books'
import type { PreviewCaseId } from './file-naming/lib/pattern-preview'
import { findUnbalancedDelimiter } from './file-naming/lib/pattern-highlight'

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const { t } = useI18n()
const { hasPermission } = usePermissions()

const {
  libraries,
  rules,
  selectedRuleId,
  selectedRule,
  loading,
  saving,
  crossPlatformSanitizationEnabled,
  savingCrossPlatformSanitization,
  overriddenLibraryIds,
  dirtyRules,
  blockedByError,
  ruleName,
  effectivePattern,
  isInherited,
  isDirty,
  errorFor,
  load,
  setDraft,
  addOverride,
  removeOverride,
  resetToShippedDefault,
  discardAll,
  saveAll,
  setCrossPlatformSanitization,
} = useFileNamingRules()

const helpOpen = ref(false)
/** Below the two-column width the rail and the editor are separate screens, so one of them is showing. */
const mobileView = ref<'rail' | 'editor'>('rail')
/** Kept across rules, so a long title chosen to test one pattern can test the next one too. */
const previewBookId = ref<PreviewBookId>('sample')
const caseId = ref<PreviewCaseId>('complete')

const EDITOR_ID = 'file-naming-editor'

onMounted(() => {
  void load()
})

// A missing-metadata case belongs to the rule it was opened on.
watch(selectedRuleId, () => {
  caseId.value = 'complete'
})

function ruleIcon(rule: NamingRule): string {
  if (rule.kind === 'global') return GLOBAL_RULE_ICONS[rule.globalKey!]
  return rule.library?.icon || 'FolderOpen'
}

function toRailItem(rule: NamingRule): RailItem {
  return {
    id: rule.id,
    name: ruleName(rule),
    icon: ruleIcon(rule),
    custom: rule.kind === 'library' && !isInherited(rule),
    dirty: isDirty(rule),
  }
}

/** Each library sits under the default for its organization mode, whether or not it overrides it. */
const railGroups = computed<RailGroup[]>(() =>
  rules.value
    .filter((rule) => rule.kind === 'global')
    .map((rule) => ({
      rule: toRailItem(rule),
      libraries: rules.value
        .filter((entry) => entry.kind === 'library' && rule.target === 'upload' && entry.organizationMode === rule.organizationMode)
        .map(toRailItem),
      separate: rule.target === 'download',
    })),
)

const activePattern = computed(() => (selectedRule.value ? effectivePattern(selectedRule.value) : ''))
const activeName = computed(() => (selectedRule.value ? ruleName(selectedRule.value) : ''))
const activeInherited = computed(() => (selectedRule.value ? isInherited(selectedRule.value) : false))
/** Set while the field is completing a token, whose open brace is unfinished rather than wrong. */
const completingToken = ref(false)
const completingOnly = computed(() => completingToken.value && findUnbalancedDelimiter(activePattern.value) === '{')
const activeError = computed(() => (selectedRule.value && !completingOnly.value ? errorFor(selectedRule.value) : ''))
/** The save bar stays calm only when the token being typed is the sole thing blocking Save. */
const quietSaveBar = computed(
  () => completingOnly.value && !dirtyRules.value.some((rule) => rule.id !== selectedRuleId.value && errorFor(rule) !== ''),
)

// The result panel resolves the pattern several times over. Phones cannot do that per
// keystroke without the on-screen keyboard stuttering, so the preview trails the field
// there and stays in lockstep on desktop.
const previewPattern = useDebouncedPatternPreview(activePattern)

const usedBy = computed<RuleLink[]>(() => {
  const rule = selectedRule.value
  if (!rule || rule.kind !== 'global') return []
  return librariesGovernedBy(rule, libraries.value, overriddenLibraryIds.value).map((library) => ({
    id: `library:${library.id}` as const,
    name: library.name,
  }))
})

const base = computed<RuleLink | null>(() => {
  const rule = selectedRule.value
  if (!rule || rule.kind !== 'library') return null
  const key = globalKeyForMode(rule.organizationMode ?? 'book_per_file')
  return { id: `global:${key}`, name: ruleName(globalRule(key)) }
})

/** Libraries whose files this pattern renames on the next save of a book's details. */
const renamingLibraries = computed<string[]>(() => {
  const rule = selectedRule.value
  if (!rule || rule.target !== 'upload') return []
  if (rule.kind === 'library') return rule.library?.fileRenameEnabled ? [rule.library.name] : []
  return librariesGovernedBy(rule, libraries.value, overriddenLibraryIds.value)
    .filter((library) => library.fileRenameEnabled)
    .map((library) => library.name)
})

const canBulkRename = computed(() => hasPermission('manage_libraries'))

function handleCompleting(value: boolean) {
  completingToken.value = value
}

function handleSelect(id: NamingRuleId) {
  selectedRuleId.value = id
  mobileView.value = 'editor'
}

function handlePattern(value: string) {
  if (selectedRule.value) setDraft(selectedRule.value, value)
}

function handlePreviewBook(value: PreviewBookId) {
  previewBookId.value = value
}

function handleCase(value: PreviewCaseId) {
  caseId.value = value
}

function handleAddOverride() {
  if (selectedRule.value) addOverride(selectedRule.value)
}

function handleRemoveOverride() {
  if (selectedRule.value) removeOverride(selectedRule.value)
}

function handleResetToShipped() {
  if (selectedRule.value) resetToShippedDefault(selectedRule.value)
}

function handleBack() {
  mobileView.value = 'rail'
}

function openHelp() {
  helpOpen.value = true
}

function handleApplyExample(pattern: string) {
  if (selectedRule.value) setDraft(selectedRule.value, pattern)
}

function handleSave() {
  void saveAll()
}

function handleDiscard() {
  discardAll()
}

function handleSanitize(value: boolean) {
  void setCrossPlatformSanitization(value)
}
</script>

<template>
  <div class="@container/naming space-y-4 pb-16">
    <SettingsPageHeader
      v-if="!props.embedded"
      class="hidden md:flex"
      :title="t('settings.reader.fileNaming.title')"
      :subtitle="t('settings.reader.fileNaming.subtitle')"
    />
    <div v-if="!props.embedded" class="px-1 md:hidden">
      <h1 class="text-xl font-semibold tracking-tight text-foreground">{{ t('settings.reader.fileNaming.title') }}</h1>
      <p class="mt-1 text-sm leading-5 text-muted-foreground">{{ t('settings.reader.fileNaming.subtitleShort') }}</p>
    </div>

    <div v-if="loading" class="flex items-center justify-center rounded-lg border border-border bg-card px-6 py-20 shadow-xs">
      <Loader2 :size="24" class="animate-spin text-muted-foreground" aria-hidden="true" />
      <span class="sr-only">{{ t('common.loading') }}</span>
    </div>

    <template v-else>
      <div class="rounded-lg border border-border bg-card shadow-xs">
        <div class="overflow-clip rounded-lg @2xl/naming:grid @2xl/naming:grid-cols-[15.5rem_minmax(0,1fr)] @2xl/naming:items-stretch">
          <NamingRuleRail
            :class="mobileView === 'editor' ? 'hidden @2xl/naming:flex' : 'flex'"
            :groups="railGroups"
            :selected-id="selectedRuleId"
            :editor-id="EDITOR_ID"
            @select="handleSelect"
          />

          <div :id="EDITOR_ID" :class="mobileView === 'rail' ? 'hidden @2xl/naming:block' : 'block'">
            <NamingRuleEditor
              v-if="selectedRule"
              :rule="selectedRule"
              :name="activeName"
              :icon="ruleIcon(selectedRule)"
              :pattern="activePattern"
              :preview-pattern="previewPattern"
              :inherited="activeInherited"
              :dirty="isDirty(selectedRule)"
              :error="activeError"
              :sanitize="crossPlatformSanitizationEnabled"
              :preview-book-id="previewBookId"
              :case-id="caseId"
              :used-by="usedBy"
              :base="base"
              :renaming-libraries="renamingLibraries"
              :can-bulk-rename="canBulkRename"
              @update:pattern="handlePattern"
              @update:preview-book-id="handlePreviewBook"
              @update:case-id="handleCase"
              @add-override="handleAddOverride"
              @remove-override="handleRemoveOverride"
              @reset-to-shipped="handleResetToShipped"
              @open-examples="openHelp"
              @select="handleSelect"
              @back="handleBack"
              @completing="handleCompleting"
            />
          </div>
        </div>

        <FileNamingSaveBar
          v-if="dirtyRules.length > 0"
          class="rounded-b-lg"
          :unsaved-count="dirtyRules.length"
          :saving="saving"
          :blocked="blockedByError"
          :quiet="quietSaveBar"
          @save="handleSave"
          @discard="handleDiscard"
        />
      </div>

      <div class="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3.5 shadow-xs md:px-5">
        <div class="min-w-0 flex-1">
          <p class="settings-label">{{ t('settings.reader.fileNaming.crossPlatform') }}</p>
          <p class="settings-hint">{{ t('settings.reader.fileNaming.crossPlatformHint') }}</p>
        </div>
        <ToggleSwitch
          :model-value="crossPlatformSanitizationEnabled"
          :disabled="savingCrossPlatformSanitization"
          :aria-label="t('settings.reader.fileNaming.crossPlatform')"
          @update:model-value="handleSanitize"
        />
      </div>
    </template>

    <PatternExamplesSheet
      v-if="selectedRule"
      v-model:open="helpOpen"
      :target="selectedRule.target"
      :organization-mode="selectedRule.organizationMode"
      :sanitize="crossPlatformSanitizationEnabled"
      @apply="handleApplyExample"
    />
  </div>
</template>
