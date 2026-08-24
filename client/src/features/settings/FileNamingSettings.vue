<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Info, Loader2 } from '@lucide/vue'
import SettingsPageHeader from './SettingsPageHeader.vue'
import NamingRuleRail, { type RailItem } from './file-naming/components/NamingRuleRail.vue'
import NamingRuleEditor from './file-naming/components/NamingRuleEditor.vue'
import NamingResultPanel from './file-naming/components/NamingResultPanel.vue'
import FileNamingSaveBar from './file-naming/components/FileNamingSaveBar.vue'
import PatternExamplesSheet from './file-naming/components/PatternExamplesSheet.vue'
import { useDebouncedPatternPreview } from './composables/useDebouncedPatternPreview'
import { useFileNamingRules } from './file-naming/composables/useFileNamingRules'
import { GLOBAL_RULE_ICONS, globalKeyForMode, librariesGovernedBy, type NamingRule, type NamingRuleId } from './file-naming/lib/naming-rules'

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const { t } = useI18n()

const {
  libraries,
  visibleRules,
  selectedRuleId,
  selectedRule,
  query,
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
/** Below md the rail and the editor are separate screens, so one of them is showing. */
const mobileView = ref<'rail' | 'editor'>('rail')

const EDITOR_ID = 'file-naming-editor'

onMounted(() => {
  void load()
})

// A filter that hides the selected rule would leave the editor showing something the
// rail no longer lists, so follow the filter down to the first surviving rule.
watch(visibleRules, (rules) => {
  if (rules.length === 0) return
  if (rules.some((rule) => rule.id === selectedRuleId.value)) return
  const first = rules[0]
  if (first) selectedRuleId.value = first.id
})

function ruleIcon(rule: NamingRule): string {
  if (rule.kind === 'global') return GLOBAL_RULE_ICONS[rule.globalKey!]
  return rule.library?.icon || 'FolderOpen'
}

// A library's organization mode decides which global default it falls back to, which is
// the fact that matters on this page; a book count would not tell the reader anything here.
function railDetail(rule: NamingRule): string {
  if (rule.kind === 'library') {
    return rule.organizationMode === 'book_per_folder'
      ? t('settings.reader.fileNaming.orgFolderAsBook')
      : t('settings.reader.fileNaming.orgFileAsBook')
  }
  if (rule.globalKey === 'download') return t('settings.reader.fileNaming.downloadScope')
  const governed = librariesGovernedBy(rule, libraries.value, overriddenLibraryIds.value).length
  return t('settings.reader.fileNaming.appliesToLibraries', { count: governed })
}

function toRailItem(rule: NamingRule): RailItem {
  return {
    id: rule.id,
    name: ruleName(rule),
    detail: railDetail(rule),
    icon: ruleIcon(rule),
    custom: rule.kind === 'library' && !isInherited(rule),
    dirty: isDirty(rule),
  }
}

const railGlobals = computed(() => visibleRules.value.filter((rule) => rule.kind === 'global').map(toRailItem))
const railLibraries = computed(() => visibleRules.value.filter((rule) => rule.kind === 'library').map(toRailItem))

const activePattern = computed(() => (selectedRule.value ? effectivePattern(selectedRule.value) : ''))
const activeName = computed(() => (selectedRule.value ? ruleName(selectedRule.value) : ''))
const activeInherited = computed(() => (selectedRule.value ? isInherited(selectedRule.value) : false))
const activeError = computed(() => (selectedRule.value ? errorFor(selectedRule.value) : ''))

// The result panel resolves the pattern four times over. Phones cannot do that per
// keystroke without the on-screen keyboard stuttering, so the preview trails the field
// there and stays in lockstep on desktop.
const previewPattern = useDebouncedPatternPreview(activePattern)

/** The global rule a library falls back to, named so the copy can point at it. */
const inheritedFromName = computed(() => {
  const rule = selectedRule.value
  if (!rule || rule.kind !== 'library') return ''
  return t(
    `settings.reader.fileNaming.rule.${globalKeyForMode(rule.organizationMode ?? 'book_per_file')}` as 'settings.reader.fileNaming.rule.fileAsBook',
  )
})

/** One line under the field saying exactly what this pattern governs today. */
const scopeSummary = computed(() => {
  const rule = selectedRule.value
  if (!rule) return ''
  if (rule.kind === 'library') return t('settings.reader.fileNaming.scopeLibrary', { name: rule.library?.name ?? '' })
  if (rule.globalKey === 'download') return t('settings.reader.fileNaming.scopeDownload')
  const governed = librariesGovernedBy(rule, libraries.value, overriddenLibraryIds.value).length
  if (governed === 0) return t('settings.reader.fileNaming.scopeGlobalNone')
  return t('settings.reader.fileNaming.scopeGlobal', { count: governed })
})

function handleSelect(id: NamingRuleId) {
  selectedRuleId.value = id
  mobileView.value = 'editor'
}

function handleQuery(value: string) {
  query.value = value
}

function handlePattern(value: string) {
  if (selectedRule.value) setDraft(selectedRule.value, value)
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
  <div class="space-y-4 pb-16">
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
      <div class="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
        <div class="md:grid md:grid-cols-[17.5rem_minmax(0,1fr)] md:items-stretch">
          <NamingRuleRail
            :class="mobileView === 'editor' ? 'hidden md:flex' : 'flex'"
            :globals="railGlobals"
            :libraries="railLibraries"
            :libraries-total="libraries.length"
            :custom-count="overriddenLibraryIds.size"
            :selected-id="selectedRuleId"
            :query="query"
            :editor-id="EDITOR_ID"
            @select="handleSelect"
            @update:query="handleQuery"
          />

          <div :id="EDITOR_ID" :class="mobileView === 'rail' ? 'hidden md:block' : 'block'">
            <div v-if="selectedRule" class="xl:grid xl:grid-cols-[minmax(0,1fr)_23rem] xl:items-start">
              <NamingRuleEditor
                :rule="selectedRule"
                :name="activeName"
                :icon="ruleIcon(selectedRule)"
                :pattern="activePattern"
                :inherited="activeInherited"
                :dirty="isDirty(selectedRule)"
                :error="activeError"
                :scope-summary="scopeSummary"
                :inherited-from-name="inheritedFromName"
                :sanitize="crossPlatformSanitizationEnabled"
                @update:pattern="handlePattern"
                @add-override="handleAddOverride"
                @remove-override="handleRemoveOverride"
                @reset-to-shipped="handleResetToShipped"
                @open-help="openHelp"
                @back="handleBack"
              />

              <div class="px-3.5 pb-4 md:px-5 xl:sticky xl:top-4 xl:self-start xl:border-l xl:border-border xl:px-4 xl:pt-4">
                <NamingResultPanel
                  :pattern="previewPattern"
                  :target="selectedRule.target"
                  :rule-name="activeName"
                  :sanitize="crossPlatformSanitizationEnabled"
                  :sanitize-busy="savingCrossPlatformSanitization"
                  @update:sanitize="handleSanitize"
                />
              </div>
            </div>
          </div>
        </div>

        <FileNamingSaveBar
          :unsaved-count="dirtyRules.length"
          :saving="saving"
          :blocked="blockedByError"
          @save="handleSave"
          @discard="handleDiscard"
        />
      </div>

      <div class="flex items-start gap-3 rounded-lg border border-primary/15 bg-primary/5 px-4 py-3 shadow-xs">
        <Info :size="16" class="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
        <p class="text-xs leading-relaxed text-muted-foreground">
          <span class="font-medium text-foreground">{{ t('settings.reader.fileNaming.howItWorks.title') }}</span>
          {{ ' ' }}{{ t('settings.reader.fileNaming.howItWorks.summary') }}
        </p>
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
