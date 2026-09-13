import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { validatePattern, type Library } from '@bookorbit/types'
import { api } from '@/lib/api'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { findUnbalancedDelimiter, findUnknownModifier } from '../lib/pattern-highlight'
import {
  GLOBAL_RULE_ENDPOINTS,
  GLOBAL_RULE_KEYS,
  globalKeyForMode,
  globalRule,
  libraryRule,
  type GlobalRuleKey,
  type NamingRule,
  type NamingRuleId,
} from '../lib/naming-rules'

/** Patterns are single-line; a null draft on a library rule means "inherit the default". */
type Draft = string | null

const SAVE_CONCURRENCY = 4

/**
 * Runs one save per rule with a small pool, so editing a dozen libraries before hitting
 * Save does not open a dozen simultaneous requests.
 */
async function runBounded<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor]
      cursor += 1
      if (item !== undefined) await worker(item)
    }
  })
  await Promise.all(runners)
}

export function useFileNamingRules() {
  const { t } = useI18n()
  const { libraries, fetchLibraries } = useLibraries()

  const savedPatterns = ref<Record<string, Draft>>({})
  const draftPatterns = ref<Record<string, Draft>>({})
  const loading = ref(true)
  const saving = ref(false)

  const crossPlatformSanitizationEnabled = ref(true)
  const loadingCrossPlatformSanitization = ref(false)
  const savingCrossPlatformSanitization = ref(false)

  const selectedRuleId = ref<NamingRuleId>('global:fileAsBook')
  const query = ref('')

  const globalRules = computed<NamingRule[]>(() => GLOBAL_RULE_KEYS.map(globalRule))
  const libraryRules = computed<NamingRule[]>(() => libraries.value.map(libraryRule))
  const rules = computed<NamingRule[]>(() => [...globalRules.value, ...libraryRules.value])

  const ruleById = computed(() => new Map(rules.value.map((rule) => [rule.id, rule])))
  const selectedRule = computed<NamingRule | null>(() => ruleById.value.get(selectedRuleId.value) ?? null)

  const overriddenLibraryIds = computed(
    () =>
      new Set(
        libraryRules.value
          .filter((rule) => draftPatterns.value[rule.id] !== null && draftPatterns.value[rule.id] !== undefined)
          .map((rule) => rule.library!.id),
      ),
  )

  function draftOf(rule: NamingRule): Draft {
    const draft = draftPatterns.value[rule.id]
    return draft === undefined ? null : draft
  }

  function globalDraft(key: GlobalRuleKey): string {
    return draftPatterns.value[`global:${key}`] ?? ''
  }

  /** What the rule resolves to today, following inheritance for a library with no override. */
  function effectivePattern(rule: NamingRule): string {
    if (rule.kind === 'global') return globalDraft(rule.globalKey!)
    const own = draftOf(rule)
    if (own !== null) return own
    return globalDraft(globalKeyForMode(rule.organizationMode ?? 'book_per_file'))
  }

  function isInherited(rule: NamingRule): boolean {
    return rule.kind === 'library' && draftOf(rule) === null
  }

  function isDirty(rule: NamingRule): boolean {
    const saved = savedPatterns.value[rule.id]
    return draftOf(rule) !== (saved === undefined ? null : saved)
  }

  function errorFor(rule: NamingRule): string {
    const draft = draftOf(rule)
    if (draft === null || draft === '') return ''
    if (!validatePattern(draft)) return t('settings.reader.fileNaming.invalidCharacters')
    const unbalanced = findUnbalancedDelimiter(draft)
    if (unbalanced === '<') return t('settings.reader.fileNaming.unbalancedOptional')
    if (unbalanced === '{') return t('settings.reader.fileNaming.unbalancedToken')
    const unknown = findUnknownModifier(draft)
    if (unknown) return t('settings.reader.fileNaming.unknownModifier', { modifier: unknown })
    return ''
  }

  const dirtyRules = computed(() => rules.value.filter(isDirty))
  const hasUnsavedChanges = computed(() => dirtyRules.value.length > 0)
  const blockedByError = computed(() => dirtyRules.value.some((rule) => errorFor(rule) !== ''))

  const visibleRules = computed(() => {
    const needle = query.value.trim().toLowerCase()
    if (!needle) return rules.value
    return rules.value.filter((rule) => ruleName(rule).toLowerCase().includes(needle))
  })

  function ruleName(rule: NamingRule): string {
    return rule.kind === 'global' ? t(`settings.reader.fileNaming.rule.${rule.globalKey}`) : (rule.library?.name ?? '')
  }

  async function fetchGlobalPattern(key: GlobalRuleKey): Promise<void> {
    const res = await api(GLOBAL_RULE_ENDPOINTS[key])
    if (!res.ok) return
    const data: { pattern: string } = await res.json()
    savedPatterns.value[`global:${key}`] = data.pattern
    draftPatterns.value[`global:${key}`] = data.pattern
  }

  async function fetchCrossPlatformSanitization(): Promise<void> {
    loadingCrossPlatformSanitization.value = true
    try {
      const res = await api('/api/v1/app-settings/cross-platform-path-sanitization')
      if (!res.ok) return
      const data: { enabled: boolean } = await res.json()
      crossPlatformSanitizationEnabled.value = data.enabled
    } finally {
      loadingCrossPlatformSanitization.value = false
    }
  }

  function seedLibraryDrafts(): void {
    for (const library of libraries.value) {
      const id: NamingRuleId = `library:${library.id}`
      const pattern = library.fileNamingPattern ?? null
      savedPatterns.value[id] = pattern
      draftPatterns.value[id] = pattern
    }
  }

  async function load(): Promise<void> {
    loading.value = true
    try {
      await Promise.all([
        ...GLOBAL_RULE_KEYS.map((key) => fetchGlobalPattern(key)),
        fetchCrossPlatformSanitization(),
        fetchLibraries().then(seedLibraryDrafts),
      ])
    } finally {
      loading.value = false
    }
  }

  function setDraft(rule: NamingRule, value: string): void {
    draftPatterns.value[rule.id] = value.replace(/[\r\n]/g, '')
  }

  /** Seeds the override from whatever the library inherits today, so nothing changes until edited. */
  function addOverride(rule: NamingRule): void {
    if (rule.kind !== 'library') return
    draftPatterns.value[rule.id] = effectivePattern(rule)
  }

  function removeOverride(rule: NamingRule): void {
    if (rule.kind !== 'library') return
    draftPatterns.value[rule.id] = null
  }

  function resetToShippedDefault(rule: NamingRule): void {
    draftPatterns.value[rule.id] = rule.shippedDefault
  }

  function discardAll(): void {
    for (const rule of rules.value) {
      const saved = savedPatterns.value[rule.id]
      draftPatterns.value[rule.id] = saved === undefined ? null : saved
    }
  }

  async function saveRule(rule: NamingRule): Promise<boolean> {
    const draft = draftOf(rule)
    if (rule.kind === 'global') {
      const res = await api(GLOBAL_RULE_ENDPOINTS[rule.globalKey!], {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pattern: draft ?? '' }),
      })
      return res.ok
    }

    const library = rule.library as Library
    const res = await api(`/api/v1/libraries/${library.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileNamingPattern: draft }),
    })
    // The library list is shared app-wide, so it only changes once the server agrees.
    if (res.ok) library.fileNamingPattern = draft
    return res.ok
  }

  async function saveAll(): Promise<void> {
    if (saving.value || blockedByError.value) return
    const pending = dirtyRules.value
    if (pending.length === 0) return

    saving.value = true
    const failed: NamingRule[] = []
    try {
      await runBounded(pending, SAVE_CONCURRENCY, async (rule) => {
        let ok = false
        try {
          ok = await saveRule(rule)
        } catch {
          ok = false
        }
        if (ok) savedPatterns.value[rule.id] = draftOf(rule)
        else failed.push(rule)
      })
    } finally {
      saving.value = false
    }

    const savedCount = pending.length - failed.length
    if (failed.length === 0) {
      toast.success(t('settings.reader.fileNaming.rulesSaved', { count: savedCount }))
      return
    }
    if (savedCount === 0) {
      toast.error(t('settings.reader.fileNaming.rulesSaveFailed', { count: failed.length }))
      return
    }
    toast.error(t('settings.reader.fileNaming.rulesPartiallySaved', { saved: savedCount, failed: failed.length }))
  }

  async function setCrossPlatformSanitization(enabled: boolean): Promise<void> {
    if (savingCrossPlatformSanitization.value) return
    const previous = crossPlatformSanitizationEnabled.value
    crossPlatformSanitizationEnabled.value = enabled
    savingCrossPlatformSanitization.value = true
    try {
      const res = await api('/api/v1/app-settings/cross-platform-path-sanitization', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      if (res.ok) {
        toast.success(enabled ? t('settings.reader.fileNaming.crossPlatformEnabled') : t('settings.reader.fileNaming.crossPlatformDisabled'))
      } else {
        crossPlatformSanitizationEnabled.value = previous
        toast.error(t('settings.reader.fileNaming.crossPlatformSaveFailed'))
      }
    } finally {
      savingCrossPlatformSanitization.value = false
    }
  }

  return {
    libraries,
    rules,
    globalRules,
    libraryRules,
    visibleRules,
    selectedRuleId,
    selectedRule,
    query,
    loading,
    saving,
    crossPlatformSanitizationEnabled,
    loadingCrossPlatformSanitization,
    savingCrossPlatformSanitization,
    overriddenLibraryIds,
    dirtyRules,
    hasUnsavedChanges,
    blockedByError,
    ruleName,
    draftOf,
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
  }
}
