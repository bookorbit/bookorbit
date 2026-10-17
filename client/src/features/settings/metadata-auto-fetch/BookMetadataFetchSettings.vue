<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { useMediaQuery } from '@vueuse/core'
import { RefreshCw } from '@lucide/vue'
import type { BookMetadataFetchConditions } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { formatList, formatRelativeTimeFromNow } from '@/i18n/formatters'
import IgnoreCacheCheckbox from '@/features/metadata-cache/components/IgnoreCacheCheckbox.vue'
import FieldRulesScopeTabs from '@/features/settings/metadata-preferences/components/FieldRulesScopeTabs.vue'
import FieldRulesSaveBar from '@/features/settings/metadata-preferences/components/FieldRulesSaveBar.vue'
import { useBookMetadataFetchActions } from '@/features/book-metadata-fetch/composables/useBookMetadataFetchActions'
import AutoFetchConditionColumns from './components/AutoFetchConditionColumns.vue'
import AutoFetchPreviewList from './components/AutoFetchPreviewList.vue'
import AutoFetchQueueBand from './components/AutoFetchQueueBand.vue'
import { useAutoFetchPreview } from './composables/useAutoFetchPreview'
import { useAutoFetchScopes, type AutoFetchScopeId } from './composables/useAutoFetchScopes'
import { fetchesOnImport, onImportChoice, type ConditionKey, type OnImportChoice } from './lib/auto-fetch-rules'

const JUST_NOW_MS = 2 * 60 * 1000

const { t } = useI18n()
const scopes = useAutoFetchScopes()
const { triggerGlobal, triggerForLibrary } = useBookMetadataFetchActions()
const isPhone = useMediaQuery('(max-width: 767px)')

const ignoreCache = ref(false)
const running = ref(false)

const conditions = computed(() => scopes.activeConfig.value?.conditions ?? null)
const previewLimit = computed(() => (isPhone.value ? 6 : 12))
const preview = useAutoFetchPreview(conditions, scopes.activeLibraryIds, previewLimit)

const library = computed(() => scopes.activeLibrary.value)
const globalOn = computed(() => (scopes.draftGlobal.value ? fetchesOnImport(scopes.draftGlobal.value) : false))
const importChoice = computed<OnImportChoice>(() => (library.value ? onImportChoice(library.value.draft) : globalOn.value ? 'on' : 'off'))
const importOwn = computed(() => scopes.activeOwnKeys.value.includes('onImport'))
const libraryNames = computed(() => (library.value ? null : new Map(scopes.libraries.value.map((item) => [item.id, item.name]))))

const globalCoverage = computed(() =>
  t('settings.metadata.autoFetch.scope.globalCoverage', {
    libraryCount: scopes.followerIds.value.length,
    bookCount: preview.breakdown.value?.total ?? 0,
  }),
)
const ownLibrariesText = computed(() => {
  const own = scopes.ownRuleLibraries.value
  return own.length ? t('settings.metadata.autoFetch.scope.ownLibraries', { names: formatList(own.map((item) => item.name)), count: own.length }) : ''
})
const lastRunText = computed(() => {
  const current = library.value
  if (!current) return ''
  if (!current.lastRunAt) return t('settings.metadata.autoFetch.scope.neverRun')
  const recent = Date.now() - new Date(current.lastRunAt).getTime() < JUST_NOW_MS
  const when = recent ? t('settings.metadata.autoFetch.lastRun.justNow') : formatRelativeTimeFromNow(current.lastRunAt, { smallestUnit: 'minute' })
  return t('settings.metadata.autoFetch.scope.lastRun', { when, count: current.lastQueuedCount ?? 0 })
})
const runLabel = computed(() =>
  library.value ? t('settings.metadata.autoFetch.run.library', { library: library.value.name }) : t('settings.metadata.autoFetch.run.all'),
)
const importOptions = computed(() => [
  {
    value: 'follow' as const,
    label: t('settings.metadata.autoFetch.onImport.follow'),
    sub: globalOn.value ? t('settings.metadata.autoFetch.onImport.on') : t('settings.metadata.autoFetch.onImport.off'),
  },
  { value: 'on' as const, label: t('settings.metadata.autoFetch.onImport.on'), sub: '' },
  { value: 'off' as const, label: t('settings.metadata.autoFetch.onImport.off'), sub: '' },
])

onMounted(scopes.load)

function selectScope(id: AutoFetchScopeId) {
  scopes.select(id)
}

function setCondition(key: ConditionKey, value: BookMetadataFetchConditions[ConditionKey]) {
  scopes.setCondition(key, value)
}

function followGlobal(key: ConditionKey) {
  scopes.followGlobal(key)
}

function followGlobalRule() {
  scopes.followGlobal('all')
}

function toggleGlobalImport(on: boolean) {
  scopes.setOnImport(on ? 'on' : 'off')
}

function chooseImport(choice: OnImportChoice) {
  scopes.setOnImport(choice)
}

async function handleSave() {
  const name = scopes.activeName.value
  if (await scopes.save()) toast.success(t('settings.metadata.autoFetch.scope.saved', { scope: name }))
  else toast.error(t('settings.metadata.autoFetch.scope.saveFailed', { scope: name }))
}

function handleDiscard() {
  scopes.discard()
}

async function handleRun() {
  if (running.value || scopes.runBlocked.value) return
  running.value = true
  try {
    const options = { ignoreCache: ignoreCache.value }
    const { queued } = library.value ? await triggerForLibrary(library.value.id, options) : await triggerGlobal(options)
    toast.success(
      queued > 0 ? t('settings.metadata.autoFetch.trigger.queued', { count: queued }) : t('settings.metadata.autoFetch.trigger.noneFound'),
    )
    ignoreCache.value = false
    await scopes.refreshRuns()
  } catch {
    toast.error(t('settings.metadata.autoFetch.run.failed'))
  } finally {
    running.value = false
  }
}
</script>

<template>
  <div v-if="scopes.loading.value && !scopes.draftGlobal.value" class="settings-loading-state">{{ t('common.loading') }}</div>
  <div v-else-if="scopes.loadFailed.value || !conditions" class="settings-error-state" role="alert">
    {{ t('settings.metadata.autoFetch.scope.loadFailed') }}
  </div>

  <div v-else class="flex flex-col gap-6">
    <AutoFetchQueueBand />

    <!-- overflow-clip, not hidden: hidden would make the card the save bar's scroll container and stop it sticking. -->
    <div class="@container overflow-clip rounded-lg border border-border bg-card shadow-xs" data-testid="auto-fetch-card">
      <FieldRulesScopeTabs
        :scopes="scopes.scopes.value"
        :active-id="scopes.activeId.value"
        override-count-key="settings.metadata.autoFetch.scope.ownSettings"
        @select="selectScope"
      />

      <div class="flex flex-col gap-3 px-4 py-3 md:min-h-14 md:flex-row md:items-center md:justify-between md:px-6">
        <p v-if="library" class="min-w-0 text-[13px] text-foreground">
          {{
            library.draft
              ? t('settings.metadata.autoFetch.scope.libraryOwn', { library: library.name, count: scopes.activeOwnKeys.value.length })
              : t('settings.metadata.autoFetch.scope.libraryFollows', { library: library.name })
          }}
          <span class="text-muted-foreground">{{ lastRunText }}</span>
        </p>
        <p v-else class="min-w-0 text-[13px] text-foreground">
          {{ t('settings.metadata.autoFetch.scope.globalIntro') }}
          <span class="text-muted-foreground">{{ globalCoverage }} {{ ownLibrariesText }}</span>
        </p>
        <div class="flex shrink-0 flex-wrap items-center gap-3">
          <Button v-if="library?.draft" variant="ghost" size="sm" @click="followGlobalRule">{{
            t('settings.metadata.autoFetch.scope.useGlobalRule')
          }}</Button>
          <IgnoreCacheCheckbox v-model="ignoreCache" compact :disabled="running" :hint="t('metadataCache.ignoreCache.runHint')" />
          <Button
            variant="outline"
            size="sm"
            :disabled="running || scopes.runBlocked.value"
            :title="scopes.runBlocked.value ? t('settings.metadata.autoFetch.run.saveFirst') : undefined"
            data-testid="auto-fetch-run"
            @click="handleRun"
          >
            <RefreshCw :size="13" :class="running ? 'animate-spin motion-reduce:animate-none' : ''" aria-hidden="true" />
            {{ runLabel }}
          </Button>
        </div>
      </div>

      <div
        class="flex flex-col gap-3 border-t border-border px-4 py-3.5 md:flex-row md:items-center md:justify-between md:gap-6 md:px-6"
        :class="importOwn ? 'shadow-[inset_0_2px_0_color-mix(in_oklch,var(--primary)_65%,transparent)]' : ''"
      >
        <div class="min-w-0">
          <p id="auto-fetch-import-label" class="settings-label">{{ t('settings.metadata.autoFetch.onImport.label') }}</p>
          <p class="settings-hint settings-prose">{{ t('settings.metadata.autoFetch.onImport.hint') }}</p>
        </div>
        <div
          v-if="library"
          role="radiogroup"
          aria-labelledby="auto-fetch-import-label"
          class="inline-flex min-w-0 shrink-0 gap-0.5 self-start rounded-md border border-input bg-muted p-0.5 md:self-center"
        >
          <button
            v-for="option in importOptions"
            :key="option.value"
            type="button"
            role="radio"
            :aria-checked="importChoice === option.value"
            class="inline-flex h-[26px] items-center justify-center gap-1.5 rounded-xs px-2.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
            :class="
              importChoice === option.value
                ? 'bg-background font-semibold text-foreground shadow-xs'
                : 'font-medium text-muted-foreground hover:text-foreground'
            "
            @click="chooseImport(option.value)"
          >
            {{ option.label }}
            <span v-if="option.sub" class="font-medium text-muted-foreground">{{ option.sub }}</span>
          </button>
        </div>
        <ToggleSwitch
          v-else
          class="self-start md:self-center"
          :model-value="globalOn"
          aria-labelledby="auto-fetch-import-label"
          @update:model-value="toggleGlobalImport"
        />
      </div>

      <div class="border-t border-border">
        <AutoFetchConditionColumns
          :conditions="conditions"
          :breakdown="preview.breakdown.value"
          :global-conditions="library ? scopes.draftGlobal.value?.conditions : null"
          :own-keys="scopes.activeOwnKeys.value"
          @set="setCondition"
          @follow-global="followGlobal"
        />
      </div>

      <AutoFetchPreviewList
        :items="preview.books.value?.items ?? []"
        :matching="preview.breakdown.value?.matching ?? null"
        :total="preview.breakdown.value?.total ?? null"
        :conditions="conditions"
        :library-names="libraryNames"
      />

      <FieldRulesSaveBar
        :dirty="scopes.activeUnsaved.value > 0"
        :unsaved-count="scopes.activeUnsaved.value"
        :scope-name="scopes.activeName.value"
        :saving="scopes.saving.value"
        @save="handleSave"
        @discard="handleDiscard"
      />
    </div>
  </div>
</template>
